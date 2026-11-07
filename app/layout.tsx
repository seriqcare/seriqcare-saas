import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/auth-context';

export const metadata: Metadata = {
  title: 'SeriqCare UI',
  description: 'SeriqCare home care SaaS demo built with Next.js',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
