import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import styles from './clock.module.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SeriqCare · Clock In / Out',
  manifest: '/clock.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'SeriqCare Clock',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#e6e9ef',
};

export default function ClockLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.className} ${styles.root}`}>{children}</div>;
}
