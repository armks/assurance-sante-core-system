import type { Metadata } from 'next';

import {
  ReclamationsEcran,
  type ReclamationAdherent,
} from '@/components/dashboard/adherent/reclamations-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Réclamations — Adhérent' };

export default async function ReclamationsPage() {
  const res = await apiFetch('/api/v1/claims/reclamations');
  const reclamations: ReclamationAdherent[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mes réclamations"
        description="Historique de vos soins soumis à remboursement et la décision d’adjudication."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ReclamationsEcran reclamations={reclamations} />
      )}
    </div>
  );
}
