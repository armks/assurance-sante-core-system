import type { Metadata } from 'next';

import {
  ReclamationsSocieteEcran,
  type ReclamationSociete,
} from '@/components/dashboard/societe/reclamations-societe-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Réclamations — Société' };

export default async function ReclamationsSocietePage() {
  const res = await apiFetch('/api/v1/claims/reclamations');
  const reclamations: ReclamationSociete[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Réclamations"
        description="Réclamations de vos adhérents et bénéficiaires : ouvertes, en cours d’analyse ou conclues."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ReclamationsSocieteEcran reclamations={reclamations} />
      )}
    </div>
  );
}
