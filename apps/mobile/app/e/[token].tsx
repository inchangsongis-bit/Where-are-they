import {
  arrivalDisplay, formatAge, formatClockTime, isLate, sortRoster, summarise,
  type Participant,
} from '@wat/core';
import { useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { api, type Snapshot } from '../../src/api';
import { loadSecret, saveSecret } from '../../src/storage';
import {
  currentPermissionLevel, requestPermissions, startTracking, stopTracking,
  type PermissionLevel,
} from '../../src/tracking/controller';

export default function EventScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const eventToken = token ?? '';

  const [secret, setSecret] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionLevel>('denied');
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot(eventToken, await loadSecret(eventToken)));
    } catch {
      // Keep showing what we last knew rather than blanking the screen.
    }
  }, [eventToken]);

  useEffect(() => {
    void (async () => {
      setSecret(await loadSecret(eventToken));
      setPermission(await currentPermissionLevel());
      await refresh();
    })();
  }, [eventToken, refresh]);

  useEffect(() => {
    const poll = setInterval(() => void refresh(), 5_000);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.join(eventToken, name);
      if (result.sessionSecret !== undefined) {
        await saveSecret(eventToken, result.sessionSecret);
        setSecret(result.sessionSecret);
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  async function checkIn() {
    if (secret === null || snapshot === null) return;
    setBusy(true);
    setError(null);
    try {
      const level = await requestPermissions();
      setPermission(level);
      setShowDisclosure(false);

      await api.updateMe(eventToken, secret, { status: 'en_route', sharing: true });

      if (level !== 'denied') {
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await startTracking({
          eventToken,
          venue: snapshot.event.venue,
          eventStartsAt: snapshot.event.startsAt,
          from: { lat: fix.coords.latitude, lng: fix.coords.longitude },
        });
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not check in.');
    } finally {
      setBusy(false);
    }
  }

  async function arrive() {
    if (secret === null) return;
    setBusy(true);
    try {
      await stopTracking('user');
      await api.updateMe(eventToken, secret, { status: 'arrived' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing() {
    if (secret === null) return;
    setBusy(true);
    try {
      await stopTracking('user');
      await api.updateMe(eventToken, secret, { sharing: false });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (snapshot === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const { event, participants } = snapshot;
  const me = participants.find((p) => p.id === snapshot.me?.id) ?? null;
  const roster = sortRoster(participants, now);
  const summary = summarise(participants);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.venue}>
        {event.venue.name} · {formatClockTime(event.startsAt, event.timezone)}
      </Text>

      {error !== null && <Text style={styles.error}>{error}</Text>}

      {me === null ? (
        <View style={styles.block}>
          <Text style={styles.heading}>What&rsquo;s your name?</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName}
            placeholder="First name" maxLength={24} />
          <Pressable style={styles.button} onPress={() => void join()} disabled={busy}>
            <Text style={styles.buttonText}>Join</Text>
          </Pressable>
        </View>
      ) : me.status === 'arrived' ? (
        <Text style={styles.here}>You&rsquo;re here. Location sharing has stopped.</Text>
      ) : showDisclosure ? (
        // PS-11 — shown *before* the system prompt. Both stores require it, and
        // Apple rejects builds that ask for Always without a visible reason.
        <View style={styles.block}>
          <Text style={styles.heading}>Before we ask for location</Text>
          <Text style={styles.body}>
            We&rsquo;ll use your location, including in the background, so your
            group can see your ETA with your phone in your pocket.
          </Text>
          <Text style={styles.body}>
            It&rsquo;s shared only with people in this event, only while
            you&rsquo;re checked in, and it stops by itself when you arrive.
          </Text>
          <Pressable style={styles.button} onPress={() => void checkIn()} disabled={busy}>
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => setShowDisclosure(false)}>
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      ) : me.status === 'not_started' ? (
        <Pressable style={styles.button} onPress={() => setShowDisclosure(true)}>
          <Text style={styles.buttonText}>I&rsquo;m on my way</Text>
        </Pressable>
      ) : (
        <View style={styles.block}>
          {me.sharing && (
            <Text style={styles.sharing}>
              ● Sharing your location with this group
              {permission === 'foreground' && ' — only while the app is open'}
            </Text>
          )}
          {me.sharing ? (
            <Pressable style={styles.secondary} onPress={() => void stopSharing()}>
              <Text style={styles.secondaryText}>Stop sharing location</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.button} onPress={() => void arrive()} disabled={busy}>
            <Text style={styles.buttonText}>I&rsquo;m here</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.tally}>
        {summary.here} here · {summary.onTheWay} on the way ·{' '}
        {summary.notStarted} not started
      </Text>

      {roster.map((participant) => (
        <Row key={participant.id} participant={participant} now={now}
          timezone={event.timezone} startsAt={event.startsAt} />
      ))}
    </ScrollView>
  );
}

function Row({
  participant, now, timezone, startsAt,
}: {
  participant: Participant;
  now: number;
  timezone: string;
  startsAt: number;
}) {
  const display = arrivalDisplay(participant, now);
  const late = isLate(participant, startsAt, now);

  const eta =
    display.kind === 'arrived' || display.kind === 'eta'
      ? formatClockTime(display.at, timezone)
      : display.kind === 'self_reported'
        ? `~${formatClockTime(display.at, timezone)}`
        : display.kind === 'last_seen'
          ? `last seen ${formatAge(display.agoMs)}`
          : '—';

  const faded = display.kind === 'last_seen' || display.kind === 'unknown' ||
    (display.kind === 'eta' && display.stale);

  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: participant.color }]}>
        <Text style={styles.avatarText}>
          {participant.displayName.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.name}>{participant.displayName}</Text>
        {participant.status === 'en_route' && (
          <Text style={styles.sub}>
            {participant.travelMode} · {participant.sharing ? 'sharing' : 'not sharing'}
            {late ? ' · late' : ''}
          </Text>
        )}
      </View>
      <Text style={[styles.eta, faded && styles.etaFaded]}>{eta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  venue: { fontSize: 14, opacity: 0.7 },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, opacity: 0.8, lineHeight: 21 },
  block: { gap: 10, marginTop: 8 },
  input: {
    borderWidth: 1, borderColor: '#D3DAD5', borderRadius: 8,
    padding: 12, fontSize: 16,
  },
  button: {
    backgroundColor: '#0B6E63', borderRadius: 8, padding: 14, alignItems: 'center',
    minHeight: 44, justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondary: {
    borderWidth: 1, borderColor: '#D3DAD5', borderRadius: 8, padding: 14,
    alignItems: 'center', minHeight: 44, justifyContent: 'center',
  },
  secondaryText: { color: '#0B6E63', fontWeight: '600', fontSize: 16 },
  sharing: {
    backgroundColor: '#DCEEE1', color: '#2C7A4C', padding: 10,
    borderRadius: 8, fontWeight: '600', fontSize: 13,
  },
  here: {
    backgroundColor: '#DCEEE1', color: '#2C7A4C', padding: 12,
    borderRadius: 8, fontWeight: '600',
  },
  error: { color: '#B24A17', fontSize: 14 },
  tally: { fontSize: 13, opacity: 0.7, marginTop: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E7E2',
  },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rowMain: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 11, opacity: 0.6, marginTop: 2 },
  eta: { fontSize: 15, fontVariant: ['tabular-nums'] },
  etaFaded: { fontSize: 12, opacity: 0.6 },
});
