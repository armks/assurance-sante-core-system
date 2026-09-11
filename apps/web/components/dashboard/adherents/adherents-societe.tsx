import { redirect } from 'next/navigation';

import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { peutGererMembres } from '@/lib/member';
import { AdherentsListe } from './adherents-liste';
import type { AdherentListe, OptionRef, PoliceRef } from './types';

/**
 * Écran « Adhérents » de la filière société — factorisé pour être rendu à
 * l'identique par les différents rôles SOCIETE_AFFILIEE qui y ont accès :
 * `SOCIETE_ADMINISTRATION` (lecture + écriture sur SON souscripteur) et les
 * rôles en lecture seule qui atterrissent ici depuis leur propre espace
 * (`SOCIETE_RECEPTION`). `peutCreer` est dérivé du `roleChain` réel — jamais
 * codé en dur par route — et l'API reste seule juge des écritures.
 */
export async function AdherentsSociete({ basePath }: { basePath: string }) {
  const etat = await exigerIdentite(basePath);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const societeId = etat.identity.permissions.scope.societeId ?? undefined;

  const [resA, resS, resP] = await Promise.all([
    apiFetch('/api/v1/member/adherents'),
    apiFetch('/api/v1/tenant/souscripteurs'),
    apiFetch('/api/v1/policy/polices'),
  ]);
  const adherents: AdherentListe[] = resA.ok ? await resA.json() : [];
  const erreur = resA.ok ? null : await messageErreur(resA);
  const souscripteurs: OptionRef[] = resS.ok ? await resS.json() : [];
  const polices: PoliceRef[] = resP.ok ? await resP.json() : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Adhérents"
        description="Fichier des membres de votre organisation : adhérents, bénéficiaires, cartes, statut."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <AdherentsListe
          adherents={adherents}
          souscripteurs={souscripteurs}
          polices={polices}
          peutCreer={peutGererMembres(etat.identity.permissions.roleChain)}
          basePath={basePath}
          souscripteurVerrou={societeId}
        />
      )}
    </div>
  );
}
