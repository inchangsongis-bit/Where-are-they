import { describe, expect, it, vi } from 'vitest';
import { CompositePush, ExpoPush, NoopPush, isWebSubscription } from './push';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response;
}

const message = (to: string) => ({ to, title: 'Dinner', body: 'Priya is 5 minutes away' });

describe('NoopPush', () => {
  it('records what would have gone out', async () => {
    const provider = new NoopPush();
    await provider.send([message('t1')]);
    expect(provider.sent).toHaveLength(1);
  });
});

describe('CompositePush', () => {
  const webSubscription = JSON.stringify({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'k', auth: 'a' },
  });

  it('tells a browser subscription apart from an Expo token by shape', () => {
    expect(isWebSubscription(webSubscription)).toBe(true);
    expect(isWebSubscription('ExponentPushToken[abc]')).toBe(false);
    expect(isWebSubscription('{not json')).toBe(false);
    expect(isWebSubscription('{"no":"endpoint"}')).toBe(false);
  });

  it('routes each message to the service that can deliver it', async () => {
    const expo = new NoopPush();
    const web = new NoopPush();
    const composite = new CompositePush(expo, web);

    await composite.send([message('ExponentPushToken[abc]'), message(webSubscription)]);

    expect(expo.sent.map((m) => m.to)).toEqual(['ExponentPushToken[abc]']);
    expect(web.sent.map((m) => m.to)).toEqual([webSubscription]);
  });

  it('adds up what both services managed to send', async () => {
    const composite = new CompositePush(new NoopPush(), new NoopPush());
    const result = await composite.send([
      message('ExponentPushToken[abc]'), message(webSubscription),
    ]);
    expect(result.sent).toBe(2);
  });
});

describe('ExpoPush', () => {
  it('posts to the Expo endpoint with a sound', async () => {
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      void url; void init;
      return Promise.resolve(jsonResponse({ data: [{ status: 'ok' }] }));
    });
    await new ExpoPush(null, fetchImpl as unknown as typeof fetch).send([message('t1')]);

    const call = fetchImpl.mock.calls[0];
    expect(String(call?.[0])).toContain('exp.host');
    const body = JSON.parse(String(call?.[1]?.body)) as unknown[];
    expect(body[0]).toMatchObject({ to: 't1', sound: 'default' });
  });

  it('attaches the access token when one is configured', async () => {
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      void url; void init;
      return Promise.resolve(jsonResponse({ data: [{ status: 'ok' }] }));
    });
    await new ExpoPush('secret', fetchImpl as unknown as typeof fetch).send([message('t1')]);
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer secret');
  });

  it('counts what was accepted', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ data: [{ status: 'ok' }, { status: 'ok' }] })),
    );
    const result = await new ExpoPush(null, fetchImpl as unknown as typeof fetch)
      .send([message('t1'), message('t2')]);
    expect(result.sent).toBe(2);
  });

  it('reports tokens for uninstalled apps so they can be dropped (PS-12)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({
        data: [
          { status: 'ok' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
        ],
      })),
    );
    const result = await new ExpoPush(null, fetchImpl as unknown as typeof fetch)
      .send([message('good'), message('dead')]);
    expect(result.sent).toBe(1);
    expect(result.invalidTokens).toEqual(['dead']);
  });

  it('does not treat other errors as dead tokens', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({
        data: [{ status: 'error', details: { error: 'MessageRateExceeded' } }],
      })),
    );
    const result = await new ExpoPush(null, fetchImpl as unknown as typeof fetch)
      .send([message('t1')]);
    expect(result.invalidTokens).toEqual([]);
  });

  it('survives a push outage instead of throwing into the caller', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('network gone')));
    const result = await new ExpoPush(null, fetchImpl as unknown as typeof fetch)
      .send([message('t1')]);
    expect(result).toEqual({ sent: 0, invalidTokens: [] });
  });

  it('survives an HTTP error too', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, false)));
    const result = await new ExpoPush(null, fetchImpl as unknown as typeof fetch)
      .send([message('t1')]);
    expect(result.sent).toBe(0);
  });

  it('batches beyond Expo 100-message limit', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ data: Array.from({ length: 100 }, () => ({ status: 'ok' })) })),
    );
    await new ExpoPush(null, fetchImpl as unknown as typeof fetch)
      .send(Array.from({ length: 250 }, (_, i) => message(`t${i}`)));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('sends nothing for an empty list', async () => {
    const fetchImpl = vi.fn();
    const result = await new ExpoPush(null, fetchImpl as unknown as typeof fetch).send([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});
