import type { Metadata } from 'next';

import {
  ReseauPanneau,
  type LieuReseau,
} from '@/components/dashboard/reseau-panneau';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Établissements — Assurance Informatique',
};

export default async function Etablissements() {
  const res = await apiFetch('/api/v1/provider/etablissements');
  const lieux: LieuReseau[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Établissements de santé"
        description="Réseau de soins conventionné (hôpitaux, cliniques, laboratoires, imagerie…). Écriture réservée à l’Assurance Informatique."
      />
      <ReseauPanneau kind="etablissements" lieux={lieux} erreur={erreur} />
    </div>
  );
}
