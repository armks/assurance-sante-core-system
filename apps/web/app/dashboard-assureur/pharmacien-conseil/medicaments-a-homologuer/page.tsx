import type { Metadata } from 'next';

import {
  HomologationPanneau,
  type MedicamentRef,
} from '@/components/dashboard/homologation-panneau';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Médicaments à homologuer' };

export default async function MedicamentsAHomologuer() {
  const res = await apiFetch('/api/v1/reference/medicaments');
  const medicaments: MedicamentRef[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Médicaments à homologuer"
        description="Référentiel des médicaments (liste essentielle CI pré-remplie). Seul le pharmacien conseil peut faire passer un médicament de PROPOSE à HOMOLOGUE."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <HomologationPanneau kind="medicaments" medicaments={medicaments} />
      )}
    </div>
  );
}
