import { Stack } from 'expo-router';
import { useEffect } from 'react';
// Importing for the side effect is the point: TaskManager tasks must be
// defined in the top-level module graph, or the OS wakes a task that the JS
// runtime does not know about.
import '../src/tracking/task';
import { reconcileOnLaunch } from '../src/tracking/controller';

export default function RootLayout() {
  useEffect(() => {
    // Clean up anything a crash left registered (FR-10).
    void reconcileOnLaunch();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
