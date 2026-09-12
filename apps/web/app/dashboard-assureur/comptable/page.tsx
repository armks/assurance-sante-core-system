import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  ComptableVueEnsemble,
  type CotisationResume,
} from '@/components/dashboard/comptable-vue-ensemble';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Vue d’ensemble — Comptable' };

export default async function ComptableAccueil() {
  const etat = await exigerIdentite('/dashboard-assureur/comptable');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/billing/cotisations');
  const cotisations: CotisationResume[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Comptable — suivi des cotisations et des paiements. Les autres écrans de gestion de l’assureur restent réservés à l’informatique/direction/exploitation."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ComptableVueEnsemble
          cotisations={cotisations}
          peutValider={etat.identity.permissions.peutValider}
        />
      )}
    </div>
  );
}
