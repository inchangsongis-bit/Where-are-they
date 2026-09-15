'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'wat.install.dismissed';

/**
 * Offers installing the app, and registers the service worker.
 *
 * Deliberately quiet. An install banner on first visit, before someone has
 * even joined the event they were invited to, is an interruption between them
 * and the thing they came for. So it only appears once the page is doing
 * something worth keeping, and once dismissed it stays dismissed.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Registered on load rather than at push-subscribe time: the offline
      // shell should exist before anyone needs it.
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Private browsing, or storage blocked. Treat it as not dismissed.
    }
    if (dismissed) return;

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS has no install event: Safari only offers Add to Home Screen from its
    // own share sheet, so the best we can do is say where it is.
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (isIos && isSafari) setShowIosHint(true);

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Nothing to do; it will simply offer again next time.
    }
    setDeferred(null);
    setShowIosHint(false);
  }

  if (deferred === null && !showIosHint) return null;

  return (
    <div className="install" role="complementary" aria-label="Install this app">
      <div className="install-text">
        <strong>Add to your home screen</strong>
        {showIosHint ? (
          <span>Tap Share, then &ldquo;Add to Home Screen&rdquo;.</span>
        ) : (
          <span>Opens full screen, and keeps working when signal drops.</span>
        )}
      </div>
      <div className="install-actions">
        {deferred !== null && (
          <button type="button" onClick={() => {
            void deferred.prompt().then(() => dismiss());
          }}>
            Install
          </button>
        )}
        <button type="button" className="quiet" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
