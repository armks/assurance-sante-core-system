import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Assurance Santé Collective',
  description: 'Core System — assurance santé collective (Côte d’Ivoire)',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
