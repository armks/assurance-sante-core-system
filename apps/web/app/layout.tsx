import type { Metadata } from 'next';
import './globals.css';

import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: {
    default: 'Assurance Santé — Core System',
    template: '%s',
  },
  description: 'Core System — assurance santé collective (Côte d’Ivoire)',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
