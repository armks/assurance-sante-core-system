import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Brand } from '@/components/brand';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { aUneSession } from '@/lib/identity';

export default async function Accueil() {
  if (await aUneSession()) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-svh flex-col bg-gradient-to-b from-muted/40 to-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Brand />
        <div className="flex items-center gap-2">
          <ModeToggle />
          <Button asChild size="sm">
            <Link href="/login">Se connecter</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 pb-24 text-center">
        <span className="rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          Plateforme métier — Côte d’Ivoire
        </span>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Le core system de l’assurance santé collective
        </h1>
        <p className="max-w-xl text-pretty text-muted-foreground">
          Souscripteurs, produits versionnés, polices, adhésions, cotisations et
          adjudication des remboursements — une seule plateforme pour piloter votre
          activité d’assurance santé, du devis au paiement.
        </p>
        <Button asChild size="lg">
          <Link href="/login">Accéder à mon espace</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Accès réservé. Chaque compte est provisionné par un administrateur.
        </p>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-6 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Assurance Santé — Core System
      </footer>
    </div>
  );
}
