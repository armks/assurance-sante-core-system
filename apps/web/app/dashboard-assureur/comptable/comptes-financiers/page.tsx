import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  ComptesFinanciersEcran,
  type CompteFinancier,
} from '@/components/dashboard/comptes-financiers-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Comptes financiers — Comptable' };

const CIBLE = '/dashboard-assureur/comptable/comptes-financiers';

export default async function ComptesFinanciersPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/payment/comptes-financiers');
  const comptes: CompteFinancier[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Comptes financiers"
        description="Socle de trésorerie de l'assureur — comptes bancaires et caisses internes. Réservé exclusivement à ASSUREUR_COMPTABLE."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ComptesFinanciersEcran comptes={comptes} />
      )}
    </div>
  );
}
