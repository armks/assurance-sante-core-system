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
  title: 'Établissements — Assurance Informatique',
};

export default async function Etablissements() {
  const res = await apiFetch('/api/v1/provider/etablissements');
  const lieux: LieuReseau[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);
  const [etat, desactives] = await Promise.all([exigerIdentite('/dashboard-assureur/informatique/etablissements'), comptesDesactivesParPerimetre()]);
  const peutReactiver = etat.kind === 'ok' && etat.identity.permissions.roleChain.includes('ASSUREUR_INFORMATIQUE');
  const verdicts = await verdictsListe('etablissement', lieux.map((l) => l.id));

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Établissements de santé"
        description="Réseau de soins conventionné (hôpitaux, cliniques, laboratoires, imagerie…). Écriture réservée à l’Assurance Informatique."
      />
      <ReseauPanneau kind="etablissements" lieux={lieux} erreur={erreur} verdicts={verdicts} desactives={desactives.etablissements} peutReactiver={peutReactiver} />
    </div>
  );
}
