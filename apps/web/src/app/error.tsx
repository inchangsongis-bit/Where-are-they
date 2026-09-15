'use client';

import { useEffect } from 'react';

/**
 * The last line of defence. It says what to do rather than what broke: the
 * digest is for the logs, and a stack trace helps nobody standing outside a
 * restaurant.
 */
export default function ErrorBoundary({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled UI error:', error);
  }, [error]);

  return (
    <main className="prose">
      <h1>Something went wrong</h1>
      <p className="lead">
        The app hit a problem it didn&rsquo;t expect. Your event is fine —
        nothing was lost.
      </p>
      <p>
        <button type="button" onClick={reset}>Try again</button>
      </p>
      {error.digest !== undefined && (
        <p className="hint">Reference: {error.digest}</p>
      )}
    </main>
  );
}
