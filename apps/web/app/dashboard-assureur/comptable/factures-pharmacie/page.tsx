import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  FacturesPharmacieComptableEcran,
  type FactureMensuellePharmacieComptable,
} from '@/components/dashboard/factures-pharmacie-comptable-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Factures pharmacie — Comptable' };

const CIBLE = '/dashboard-assureur/comptable/factures-pharmacie';

export default async function ComptableFacturesPharmaciePage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/pharmacy/factures-mensuelles/pour-comptable');
  const factures: FactureMensuellePharmacieComptable[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Factures pharmacie prêtes à programmer"
        description="Consolidations mensuelles validées par le pharmacien conseil — invisibles ici tant qu'elles ne le sont pas."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturesPharmacieComptableEcran factures={factures} cible={CIBLE} />
      )}
    </div>
  );
}
