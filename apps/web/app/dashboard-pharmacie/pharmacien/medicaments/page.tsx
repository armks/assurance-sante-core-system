import type { Metadata } from 'next';

import {
  MedicamentsEcran,
  type MedicamentReference,
} from '@/components/dashboard/pharmacie/medicaments-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Médicaments remboursables — Pharmacien' };

export default async function MedicamentsPage() {
  const res = await apiFetch('/api/v1/reference/medicaments?statut=HOMOLOGUE');
  const medicaments: MedicamentReference[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Médicaments remboursables"
        description="Référentiel national homologué — taux et plafond de remboursement standards."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <MedicamentsEcran medicaments={medicaments} />
      )}
    </div>
  );
}
