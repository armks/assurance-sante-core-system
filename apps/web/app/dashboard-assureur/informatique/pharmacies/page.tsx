import type { Metadata } from 'next';

import {
  ReseauPanneau,
  type LieuReseau,
} from '@/components/dashboard/reseau-panneau';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Pharmacies — Assurance Informatique',
};

export default async function Pharmacies() {
  const res = await apiFetch('/api/v1/provider/pharmacies');
  const lieux: LieuReseau[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Pharmacies"
        description="Officines conventionnées du réseau. Écriture réservée à l’Assurance Informatique."
      />
      <ReseauPanneau kind="pharmacies" lieux={lieux} erreur={erreur} />
    </div>
  );
}
