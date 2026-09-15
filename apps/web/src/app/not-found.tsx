import Link from 'next/link';

/**
 * PS-4 — a bad token and an expired one give the same answer, so this page
 * cannot be used to work out which invite links exist.
 */
export default function NotFound() {
  return (
    <main className="prose">
      <h1>That link doesn&rsquo;t work</h1>
      <p className="lead">
        Either it was mistyped, or the event has expired — events are deleted a
        week after they happen.
      </p>
      <p>Ask whoever invited you to send it again.</p>
      <p className="back">
        <Link href="/">Create an event</Link>
      </p>
    </main>
  );
}
