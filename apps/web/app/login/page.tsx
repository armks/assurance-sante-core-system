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
      {/* Même effet d'ouverture que le méga menu de la vitrine : le bloc d'accueil descend en fondu, la carte de connexion se déroule du haut, puis la note
          de bas de page — l'un après l'autre (classes megamenu-*). Hors de l'effet générique d'apparition (data-sans-defilement). */}
      <div className="w-full max-w-sm" data-sans-defilement>
        <div className="megamenu-colonne mb-8 flex flex-col items-center gap-4 text-center" style={{ animationDelay: '350ms' }}>
          <Brand size="lg" />
          <p className="text-sm text-muted-foreground">
            Plateforme de gestion de l’assurance santé collective.
            <br />
            Connectez-vous avec votre compte professionnel.
          </p>
        </div>

        <div className="megamenu-panneau" style={{ animationDelay: '600ms' }}>
          <LoginForm />
        </div>

        <p className="megamenu-colonne mt-6 text-center text-xs text-muted-foreground" style={{ animationDelay: '1100ms' }}>
          Accès réservé. Un compte est créé par votre administrateur.
        </p>
      </div>
    </main>
  );
}
