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

export const metadata: Metadata = { title: 'Suivi des paiements — Comptable' };

const CIBLE = '/dashboard-assureur/comptable/paiements';

export default async function ComptablePaiementsPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resFactures, resGroupes, resComptes] = await Promise.all([
    apiFetch('/api/v1/payment/factures-mensuelles'),
    apiFetch('/api/v1/payment/paiements-groupes'),
    apiFetch('/api/v1/payment/comptes-financiers'),
  ]);
  const factures: FactureGlobale[] = resFactures.ok ? await resFactures.json() : [];
  const groupes: PaiementGroupeResume[] = resGroupes.ok ? await resGroupes.json() : [];
  // 403 attendu pour ASSUREUR_COMPTABLE_ADJOINT (réservé au rôle EXACT
  // ASSUREUR_COMPTABLE, payerFacture aussi) — pas une erreur de page, juste
  // aucun compte à proposer : l'adjoint ne peut alors pas payer, seulement
  // consulter/valider/regrouper, cohérent avec le 403 qu'il obtiendrait.
  const comptes: CompteFinancier[] = resComptes.ok ? await resComptes.json() : [];
  const erreur = resFactures.ok ? (resGroupes.ok ? null : await messageErreur(resGroupes)) : await messageErreur(resFactures);

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
