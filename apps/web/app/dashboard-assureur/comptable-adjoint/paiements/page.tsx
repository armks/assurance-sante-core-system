import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import type { CompteFinancier } from '@/components/dashboard/comptes-financiers-ecran';
import {
  SuiviPaiementsEcran,
  type FactureGlobale,
  type PaiementGroupeResume,
} from '@/components/dashboard/suivi-paiements-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Suivi des paiements — Comptable Adjoint' };

const CIBLE = '/dashboard-assureur/comptable-adjoint/paiements';

export default async function ComptableAdjointPaiementsPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resFactures, resGroupes, resComptes] = await Promise.all([
    apiFetch('/api/v1/payment/factures-mensuelles'),
    apiFetch('/api/v1/payment/paiements-groupes'),
    apiFetch('/api/v1/payment/comptes-financiers'),
  ]);
  const factures: FactureGlobale[] = resFactures.ok ? await resFactures.json() : [];
  // 403 attendu ici pour l'adjoint : paiements-groupes (comme comptes-financiers
  // et payerFacture) est réservé au rôle EXACT ASSUREUR_COMPTABLE depuis la
  // fermeture de l'exception du 2026-09-24 (PROGRESSION.md) — l'adjoint garde la
  // consultation/validation des factures, mais ni le regroupement ni le paiement
  // réel ne lui sont accessibles. Dégradé silencieusement en liste vide plutôt
  // que de bloquer toute la page.
  const groupes: PaiementGroupeResume[] = resGroupes.ok ? await resGroupes.json() : [];
  const comptes: CompteFinancier[] = resComptes.ok ? await resComptes.json() : [];
  const erreur = resFactures.ok ? null : await messageErreur(resFactures);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Suivi des paiements"
        description="Toutes les factures mensuelles (établissements et pharmacies), filtres multicritères combinables, et diagramme de consommation."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <SuiviPaiementsEcran
          facturesInitiales={factures}
          paiementsGroupesInitiaux={groupes}
          comptes={comptes}
          cible={CIBLE}
        />
      )}
    </div>
  );
}
