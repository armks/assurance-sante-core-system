import type { Metadata } from 'next';
import './globals.css';

import { DefilementAncres } from '@/components/defilement-ancres';
import { EffetDefilement } from '@/components/effet-defilement';
import { EffetParallaxe } from '@/components/effet-parallaxe';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: {
    default: 'Assurance Santé — Core System',
    template: '%s',
  },
  description: 'Core System — assurance santé collective (Côte d’Ivoire)',
};

/** `modal` : emplacement parallèle (`app/@modal`) de la connexion en superposition. */
export default function RootLayout({
  children,
  modal,
}: Readonly<{ children: React.ReactNode; modal: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <EffetDefilement />
          <EffetParallaxe />
          <DefilementAncres />
          {children}
          {modal}
        </ThemeProvider>
      </body>
    </html>
  );
}
