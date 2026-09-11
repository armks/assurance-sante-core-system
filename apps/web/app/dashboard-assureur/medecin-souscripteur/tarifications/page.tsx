import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import {
  TarificationsListe,
  type TarificationLigne,
} from '@/components/dashboard/underwriting/tarifications-liste';
import { PageTitre } from '@/components/page-titre';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Tarifications individuelles — Médecin Souscripteur',
};

export default async function TarificationsPage() {
  const res = await apiFetch('/api/v1/underwriting/tarifications');
  const tarifications: TarificationLigne[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/medecin-souscripteur">
          <ArrowLeft className="size-4" />
          Vue d’ensemble
        </Link>
      </Button>

      <PageTitre
        titre="Tarifications individuelles"
        description="Primes au risque déjà calculées (prime de base + surprime médicale). Lecture seule — le calcul est déclenché à la souscription."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <TarificationsListe tarifications={tarifications} />
      )}
    </div>
  );
}
