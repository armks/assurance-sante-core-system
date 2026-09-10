import type { Metadata } from 'next';

import {
  ReclamationsListe,
  type Reclamation,
} from '@/components/dashboard/reclamations/reclamations-liste';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Réclamations — Assurance Informatique' };

export default async function ReclamationsPage() {
  const res = await apiFetch('/api/v1/claims/reclamations');
  const reclamations: Reclamation[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Réclamations"
        description="Suivi de l’adjudication : décision automatique du microservice, file de revue manuelle, remboursements."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ReclamationsListe reclamations={reclamations} />
      )}
    </div>
  );
}
