/**
 * FR-18 — delivering a notification.
 *
 * Expo Push sits in front of APNs and FCM, which is why D-1 makes push cheaper
 * on native than the web equivalent: no APNs certificates, no FCM service
 * account, no key rotation.
 *
 * Delivery is best effort by design. A dinner app that fails a database write
 * because a push receipt came back malformed has its priorities backwards.
 */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushResult {
  sent: number;
  /** Tokens the service says are dead, so we can stop using them (PS-12). */
  invalidTokens: string[];
}

export interface PushProvider {
  readonly name: string;
  send(messages: readonly PushMessage[]): Promise<PushResult>;
}

/** Used in tests and wherever push is not configured. */
export class NoopPush implements PushProvider {
  readonly name = 'noop';
  readonly sent: PushMessage[] = [];

  send(messages: readonly PushMessage[]): Promise<PushResult> {
    this.sent.push(...messages);
    return Promise.resolve({ sent: messages.length, invalidTokens: [] });
  }
}

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100; // Expo's documented maximum per request.

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

export class ExpoPush implements PushProvider {
  readonly name = 'expo';

  constructor(
    private readonly accessToken: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(messages: readonly PushMessage[]): Promise<PushResult> {
    if (messages.length === 0) return { sent: 0, invalidTokens: [] };

    let sent = 0;
    const invalidTokens: string[] = [];

    for (let index = 0; index < messages.length; index += EXPO_BATCH) {
      const batch = messages.slice(index, index + EXPO_BATCH);

      try {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          accept: 'application/json',
        };
        if (this.accessToken !== null) {
          headers['authorization'] = `Bearer ${this.accessToken}`;
        }

        const response = await this.fetchImpl(EXPO_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(
            batch.map((message) => ({
              to: message.to,
              title: message.title,
              body: message.body,
              sound: 'default',
              ...(message.data === undefined ? {} : { data: message.data }),
            })),
          ),
        });

        if (!response.ok) continue;

        const payload = (await response.json()) as { data?: ExpoTicket[] };
        const tickets = payload.data ?? [];

        tickets.forEach((ticket, position) => {
          if (ticket.status === 'ok') {
            sent += 1;
            return;
          }
          // PS-12 — a token for an uninstalled app is dead. Keeping it means
          // retrying forever and eventually being rate limited.
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const token = batch[position]?.to;
            if (token !== undefined) invalidTokens.push(token);
          }
        });
      } catch (error) {
        // Best effort: a push outage must not break the request that triggered
        // it, and the group can still see everything in the app.
        console.warn('Push delivery failed:', error);
      }
    }

    return { sent, invalidTokens };
  }
}

/**
 * FR-18 — the web surface gets Web Push with VAPID.
 *
 * Best effort, as the plan says: a browser that has been closed for a day may
 * never receive it. It exists because a guest who joined from the link and
 * never installed the app is still part of the dinner.
 */
export class WebPush implements PushProvider {
  readonly name = 'web-push';

  constructor(
    private readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  async send(messages: readonly PushMessage[]): Promise<PushResult> {
    if (messages.length === 0) return { sent: 0, invalidTokens: [] };

    const webpush = (await import('web-push')).default;
    webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);

    let sent = 0;
    const invalidTokens: string[] = [];

    for (const message of messages) {
      const subscription = parseWebSubscription(message.to);
      if (subscription === null) continue;

      try {
        await webpush.sendNotification(
          subscription as Parameters<typeof webpush.sendNotification>[0],
          JSON.stringify({
            title: message.title,
            body: message.body,
            data: message.data ?? {},
          }),
        );
        sent += 1;
      } catch (error) {
        // 404 and 410 mean the browser threw the subscription away — the web
        // equivalent of DeviceNotRegistered (PS-12).
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) invalidTokens.push(message.to);
        else console.warn('Web push failed:', error);
      }
    }

    return { sent, invalidTokens };
  }
}

/**
 * A push "token" is an opaque string to the rest of the system, so the two
 * kinds are told apart by shape here rather than by a column that could drift
 * out of step with the value beside it.
 */
export function isWebSubscription(token: string): boolean {
  return parseWebSubscription(token) !== null;
}

function parseWebSubscription(token: string): { endpoint: string } | null {
  if (!token.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(token) as { endpoint?: unknown };
    return typeof parsed.endpoint === 'string'
      ? (parsed as { endpoint: string })
      : null;
  } catch {
    return null;
  }
}

/** Routes each message to whichever service can actually deliver it. */
export class CompositePush implements PushProvider {
  readonly name = 'composite';

  constructor(
    private readonly expo: PushProvider,
    private readonly web: PushProvider,
  ) {}

  async send(messages: readonly PushMessage[]): Promise<PushResult> {
    const webMessages = messages.filter((m) => isWebSubscription(m.to));
    const expoMessages = messages.filter((m) => !isWebSubscription(m.to));

    const [expoResult, webResult] = await Promise.all([
      this.expo.send(expoMessages),
      this.web.send(webMessages),
    ]);

    return {
      sent: expoResult.sent + webResult.sent,
      invalidTokens: [...expoResult.invalidTokens, ...webResult.invalidTokens],
    };
  }
}

let provider: PushProvider | undefined;

export function getPushProvider(): PushProvider {
  if (provider !== undefined) return provider;

  const expoToken = process.env.EXPO_ACCESS_TOKEN ?? '';
  const vapidPublic = process.env.VAPID_PUBLIC_KEY ?? '';
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY ?? '';
  const vapidSubject = process.env.VAPID_SUBJECT ?? '';

  const expo: PushProvider =
    expoToken !== '' || process.env.PUSH_ENABLED === 'true'
      ? new ExpoPush(expoToken === '' ? null : expoToken)
      : new NoopPush();

  const web: PushProvider =
    vapidPublic !== '' && vapidPrivate !== '' && vapidSubject !== ''
      ? new WebPush(vapidPublic, vapidPrivate, vapidSubject)
      : new NoopPush();

  provider = new CompositePush(expo, web);
  return provider;
}

/** Test seam. */
export function setPushProvider(next: PushProvider | undefined): void {
  provider = next;
}
