import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  FacturesEtablissementComptableEcran,
  type FactureMensuelleEtablissementComptable,
} from '@/components/dashboard/factures-etablissement-comptable-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Factures établissements — Comptable Adjoint' };

const CIBLE = '/dashboard-assureur/comptable-adjoint/factures-etablissement';

export default async function ComptableAdjointFacturesEtablissementPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/preauthorization/factures-mensuelles-etablissement/pour-comptable');
  const factures: FactureMensuelleEtablissementComptable[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Factures établissements"
        description="Toutes les consolidations mensuelles des établissements, tout statut — validez pour paiement une fois vérifiées par le médecin conseil."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturesEtablissementComptableEcran factures={factures} cible={CIBLE} />
      )}
    </div>
  );
}
