export const metadata = { title: 'Offline' };

/**
 * Shown when the app is opened with no connection. It exists so the answer is
 * "you're offline" rather than the browser's own error page, which looks like
 * the app itself is broken.
 */
export default function OfflinePage() {
  return (
    <main className="prose">
      <h1>You&rsquo;re offline</h1>
      <p className="lead">
        No connection, so there&rsquo;s nothing new to show. Open the event
        again once you have signal.
      </p>
      <p>
        If you were sharing your location, your phone kept the last few
        positions and will send them when you reconnect — timestamped from when
        they happened, not from when they arrive.
      </p>
    </main>
  );
}
