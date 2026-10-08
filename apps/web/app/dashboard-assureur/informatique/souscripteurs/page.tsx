import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import {
  SouscripteursEcran,
  type Souscripteur,
} from '@/components/dashboard/souscripteurs-ecran';
import { verdictsListe } from '@/app/dependances-actions';
import { comptesDesactivesParPerimetre } from '@/lib/comptes-desactives';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = {
  title: 'Souscripteurs — Assurance Informatique',
};

export default async function Souscripteurs() {
  const [etat, res] = await Promise.all([
    exigerIdentite('/dashboard-assureur/informatique/souscripteurs'),
    apiFetch('/api/v1/tenant/souscripteurs'),
  ]);
  const souscripteurs: Souscripteur[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);
  const roles = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];
  // Miroir de la règle du registre : archivage et suppression = direction et informatique.
  const peutArchiver = roles.some((r) => ['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'].includes(r));
  const desactives = await comptesDesactivesParPerimetre();
  const peutReactiver = roles.includes('ASSUREUR_INFORMATIQUE');
  const verdicts = await verdictsListe('souscripteur', souscripteurs.map((s) => s.id));

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Souscripteurs"
        description="Entreprises, collectivités et souscripteurs individuels affiliés. Module tenant/ (scopé par organisation)."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <SouscripteursEcran souscripteurs={souscripteurs} verdicts={verdicts} peutArchiver={peutArchiver} desactives={desactives.societes} peutReactiver={peutReactiver} />
      )}
    </div>
  );
}
