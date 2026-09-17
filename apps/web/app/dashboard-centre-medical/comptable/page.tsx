import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  FacturationEcran,
  type DossierClot,
} from '@/components/dashboard/centre-medical/facturation-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Facturation — Parcours de soins' };

export default async function ComptablePage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/comptable');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const etablissementId = etat.identity.permissions.scope
    .etablissementId as string;

  // Facturation par sélection d'actes, paiement partiel : un dossier OUVERT
  // peut déjà être facturé/réglé au fil du traitement (la clôture, elle,
  // reste bloquée tant que le solde n'est pas nul) — donc pas de filtre de
  // statut ici, tous les dossiers de l'établissement sont éligibles.
  const res = await apiFetch(
    `/api/v1/care-episode/dossiers?etablissementId=${etablissementId}`,
  );
  const dossiers: DossierClot[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Facturation"
        description="Les dossiers de votre établissement. Ouvrez-en un pour sélectionner les actes à régler, générer un code de facturation, et suivre le solde restant dû."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturationEcran dossiers={dossiers} />
      )}
    </div>
  );
}
