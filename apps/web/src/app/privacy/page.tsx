import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'What this app knows about you',
  robots: { index: false, follow: false },
};

/**
 * PS-9 — the plain-language version.
 *
 * Written to be read by someone who tapped a link in a group chat, not by a
 * lawyer. Every claim here is enforced somewhere in the code: the retention
 * clocks are in packages/core/src/lifecycle.ts and the purge job deletes
 * rather than filters.
 */
export default function PrivacyPage() {
  return (
    <main className="prose">
      <h1>What this app knows about you</h1>

      <p className="lead">
        It shares where you are with five other people for about an hour. That
        deserves a straight answer, so here is all of it.
      </p>

      <h2>While you&rsquo;re on your way</h2>
      <ul>
        <li>
          Your location is shared <strong>only while you&rsquo;re checked in</strong>,
          and only with the people in that one event.
        </li>
        <li>
          It <strong>stops by itself when you arrive</strong>. You can also stop
          it any time with one tap, and the app shows a marker whenever
          it&rsquo;s on.
        </li>
        <li>
          We keep your <strong>latest position</strong>, not a trail of where
          you have been. There is no history to look back through.
        </li>
        <li>
          Coordinates are rounded before they are stored, and we never turn them
          into a street address.
        </li>
      </ul>

      <h2>How long anything lasts</h2>
      <p>
        Different things deserve different clocks. These are enforced by a job
        that <em>deletes</em>, not by hiding rows from a query.
      </p>
      <table>
        <thead>
          <tr><th>What</th><th>Gone after</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Your location</td>
            <td>3 hours after the last person arrives, or 6 hours after the start</td>
          </tr>
          <tr><td>Messages in the thread</td><td>30 days</td></tr>
          <tr><td>The event itself, and your name on it</td><td>7 days</td></tr>
        </tbody>
      </table>

      <h2>What we never collect</h2>
      <ul>
        <li>No account, no email, no phone number.</li>
        <li>No contacts, no address book.</li>
        <li>No analytics or advertising trackers — none, on any page.</li>
        <li>No location at all unless you tap &ldquo;I&rsquo;m on my way&rdquo;.</li>
      </ul>

      <h2>Who can see an event</h2>
      <p>
        Anyone holding the invite link. That is the point of it — no accounts
        means no gate. So treat the link like a key: it is long and random, it
        is kept out of search engines, and it is not passed on to other sites
        when you follow a link away. An event can also carry a PIN if you want
        a second lock.
      </p>

      <h2>Leaving</h2>
      <p>
        Leaving an event removes you from it and stops any sharing immediately.
        What you said in the thread stays, attributed to your name, because the
        thread is a record of what happened that evening — but nothing about
        where you were remains.
      </p>

      <p className="back">
        <Link href="/">Back</Link>
      </p>
    </main>
  );
}
