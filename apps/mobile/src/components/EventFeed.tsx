import {
  QUICK_REPLIES, describeEntry, isSystemEntry, sortEntries, type FeedEntry,
} from '@wat/core';
import { useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

/**
 * FR-15 — the feed on native. Renders from the same rules as the web surface,
 * so a system event reads identically on both.
 */
export default function EventFeed({
  entries, myParticipantId, canPost, busy, onSend, onQuickReply,
}: {
  entries: FeedEntry[];
  myParticipantId: string | null;
  canPost: boolean;
  busy: boolean;
  onSend: (body: string) => void;
  onQuickReply: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const ordered = sortEntries(entries);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.entries} contentContainerStyle={styles.entriesContent}>
        {ordered.length === 0 && <Text style={styles.empty}>Nothing here yet.</Text>}

        {ordered.map((entry) =>
          isSystemEntry(entry) ? (
            <Text key={entry.id} style={styles.system}>
              {describeEntry(entry)} · {formatTime(entry.createdAt)}
            </Text>
          ) : (
            <View key={entry.id} style={styles.message}>
              <Text style={styles.author}>
                {entry.authorName ?? 'Someone'} · {formatTime(entry.createdAt)}
              </Text>
              <Text
                style={[
                  styles.bubble,
                  entry.participantId === myParticipantId && styles.bubbleMine,
                ]}>
                {entry.body}
              </Text>
            </View>
          ),
        )}
      </ScrollView>

      {canPost ? (
        <View style={styles.compose}>
          <View style={styles.quick}>
            {QUICK_REPLIES.map((reply) => (
              <Pressable key={reply.id} style={styles.quickButton} disabled={busy}
                onPress={() => onQuickReply(reply.id)}>
                <Text style={styles.quickText}>{reply.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.composeRow}>
            <TextInput style={styles.input} value={draft} onChangeText={setDraft}
              placeholder="Say something" maxLength={500}
              accessibilityLabel="Message" />
            <Pressable
              style={[styles.send, (busy || draft.trim() === '') && styles.sendDisabled]}
              disabled={busy || draft.trim() === ''}
              onPress={() => {
                onSend(draft);
                setDraft('');
              }}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>Join the event to post.</Text>
      )}
    </View>
  );
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(timestamp));
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  entries: { maxHeight: 360 },
  entriesContent: { gap: 10, paddingVertical: 8 },
  empty: { fontSize: 14, opacity: 0.55, paddingVertical: 8 },
  system: { fontSize: 12, opacity: 0.55 },
  message: { gap: 2 },
  author: { fontSize: 12, fontWeight: '600', opacity: 0.7 },
  bubble: {
    fontSize: 15, backgroundColor: '#F2F5F1', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 11, alignSelf: 'flex-start',
    maxWidth: '85%',
  },
  bubbleMine: { backgroundColor: '#DCEEE1' },
  compose: { gap: 10, marginTop: 12 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickButton: {
    borderWidth: 1, borderColor: '#D3DAD5', borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 12, minHeight: 44,
    justifyContent: 'center', flexGrow: 1,
  },
  quickText: { color: '#0B6E63', fontWeight: '600', fontSize: 13, textAlign: 'center' },
  composeRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#D3DAD5', borderRadius: 8,
    paddingHorizontal: 12, fontSize: 16, minHeight: 44,
  },
  send: {
    backgroundColor: '#0B6E63', borderRadius: 8, paddingHorizontal: 18,
    justifyContent: 'center', minHeight: 44,
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
