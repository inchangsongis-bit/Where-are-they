import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  MESSAGE_MAX,
  MESSAGE_MIN,
} from './constants.js';

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * FR-2 — names are free text, but trimmed and bounded. Errors say what to do
 * about it rather than restating the rule.
 */
export function validateDisplayName(input: string): Validated<string> {
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < DISPLAY_NAME_MIN) {
    return { ok: false, error: 'Enter a name so the group knows who you are.' };
  }
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: `Keep it to ${DISPLAY_NAME_MAX} characters.` };
  }
  return { ok: true, value };
}

/** FR-15 — feed messages: text only, bounded. */
export function validateMessage(input: string): Validated<string> {
  const value = input.trim();
  if (value.length < MESSAGE_MIN) {
    return { ok: false, error: 'Type a message first.' };
  }
  if (value.length > MESSAGE_MAX) {
    return { ok: false, error: `Messages are up to ${MESSAGE_MAX} characters.` };
  }
  return { ok: true, value };
}

/**
 * FR-2 — duplicate names are allowed but disambiguated, so two Sams don't
 * silently become one person in everyone's head.
 */
export function disambiguate(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const name of names) {
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return names.map((name) => {
    const key = name.toLowerCase();
    if ((counts.get(key) ?? 0) < 2) return name;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    return `${name} ${nth}`;
  });
}
