import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LedgerForge — Operations Console',
  description: 'Payment ledger and reconciliation operations dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
