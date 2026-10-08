import type { Metadata } from 'next';

import {
  ReseauPanneau,
  type LieuReseau,
} from '@/components/dashboard/reseau-panneau';
import { PageTitre } from '@/components/page-titre';
import { verdictsListe } from '@/app/dependances-actions';
import { comptesDesactivesParPerimetre } from '@/lib/comptes-desactives';
import { exigerIdentite } from '@/lib/identity';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Pharmacies — Assurance Informatique',
};

export default async function Pharmacies() {
  const res = await apiFetch('/api/v1/provider/pharmacies');
  const lieux: LieuReseau[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);
  const [etat, desactives] = await Promise.all([exigerIdentite('/dashboard-assureur/informatique/pharmacies'), comptesDesactivesParPerimetre()]);
  const peutReactiver = etat.kind === 'ok' && etat.identity.permissions.roleChain.includes('ASSUREUR_INFORMATIQUE');
  const verdicts = await verdictsListe('pharmacie', lieux.map((l) => l.id));

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Pharmacies"
        description="Officines conventionnées du réseau. Écriture réservée à l’Assurance Informatique."
      />
      <ReseauPanneau kind="pharmacies" lieux={lieux} erreur={erreur} verdicts={verdicts} desactives={desactives.pharmacies} peutReactiver={peutReactiver} />
    </div>
  );
}
