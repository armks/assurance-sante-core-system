import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { FacturationSocietesEcran, type Souscripteur } from '@/components/dashboard/facturation-societes-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Facturation sociétés — Comptable Adjoint' };

const CIBLE = '/dashboard-assureur/comptable-adjoint/facturation-societes';

export default async function ComptableAdjointFacturationSocietesPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/tenant/souscripteurs');
  const souscripteurs: Souscripteur[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Facturation sociétés"
        description="Liste des adhérents principaux éligibles à la facturation du mois (validés avant la coupure du 1er) et consolidation de la facture globale par société cliente."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturationSocietesEcran souscripteurs={souscripteurs} cible={CIBLE} />
      )}
    </div>
  );
}
