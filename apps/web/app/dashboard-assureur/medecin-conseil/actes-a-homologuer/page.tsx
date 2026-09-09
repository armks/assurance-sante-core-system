import type { Metadata } from 'next';

import {
  HomologationPanneau,
  type ActeRef,
} from '@/components/dashboard/homologation-panneau';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Actes à homologuer' };

export default async function ActesAHomologuer() {
  const res = await apiFetch('/api/v1/reference/actes');
  const actes: ActeRef[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Actes à homologuer"
        description="Référentiel des actes. Seul le médecin conseil peut faire passer un acte de PROPOSE à HOMOLOGUE."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <HomologationPanneau kind="actes" actes={actes} />
      )}
    </div>
  );
}
