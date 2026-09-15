import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * The app is opened from an invite link, not browsed. This screen exists for
 * the case where someone taps the icon directly.
 */
export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Where Are They</Text>
      <Text style={styles.body}>
        Open the invite link your group sent you and you&rsquo;ll land straight
        in the event.
      </Text>
      <Link href="/e/demo" style={styles.link}>
        Open an event
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 16, opacity: 0.7 },
  link: { fontSize: 16, color: '#0B6E63', fontWeight: '600', marginTop: 8 },
});
