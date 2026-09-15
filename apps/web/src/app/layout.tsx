import type { Metadata, Viewport } from 'next';
import './globals.css';
import InstallPrompt from './InstallPrompt';

export const metadata: Metadata = {
  title: 'Where Are They',
  description: "Who's coming, who's close, and when everyone gets here.",
  // PS-4: the invite token is a credential, so nothing here gets indexed.
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Where Are They',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eff1ee' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1514' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
