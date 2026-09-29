import type { Metadata } from 'next';

import { Brand } from '@/components/brand';
import { LoginForm } from '@/components/login-form';
import { ModeToggle } from '@/components/mode-toggle';

export const metadata: Metadata = {
  title: 'Connexion — Assurance Santé',
};

export default function LoginPage() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center bg-gradient-to-b from-muted/40 to-background px-6 py-10">
      <div className="absolute right-4 top-4">
        <ModeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Brand size="lg" />
          <p className="text-sm text-muted-foreground">
            Plateforme de gestion de l’assurance santé collective.
            <br />
            Connectez-vous avec votre compte professionnel.
          </p>
        </div>

        <LoginForm />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Accès réservé. Un compte est créé par votre administrateur.
        </p>
      </div>
    </main>
  );
}
