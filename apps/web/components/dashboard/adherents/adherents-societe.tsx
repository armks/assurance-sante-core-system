import { redirect } from 'next/navigation';

import { verdictsListe } from '@/app/dependances-actions';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { peutGererMembres, peutProposerMembres } from '@/lib/member';
import { AdherentsListe } from './adherents-liste';
import { PropositionsAdherentsPanel } from './propositions-adherents-panel';
import type { AdherentListe, ImportAdherentsResume, OptionRef, PoliceRef } from './types';

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
  const roleChain = etat.identity.permissions.roleChain;
  const peutProposer = peutProposerMembres(roleChain) && !!societeId;

  const [resA, resS, resP, resI] = await Promise.all([
    apiFetch('/api/v1/member/adherents'),
    apiFetch('/api/v1/tenant/souscripteurs'),
    apiFetch('/api/v1/policy/polices'),
    peutProposer ? apiFetch('/api/v1/member/imports-adherents') : Promise.resolve(null),
  ]);
  const adherents: AdherentListe[] = resA.ok ? await resA.json() : [];
  const erreur = resA.ok ? null : await messageErreur(resA);
  const souscripteurs: OptionRef[] = resS.ok ? await resS.json() : [];
  const polices: PoliceRef[] = resP.ok ? await resP.json() : [];
  const imports: ImportAdherentsResume[] = resI?.ok ? await resI.json() : [];
  const verdicts = await verdictsListe('adherent', adherents.map((a) => a.id));
  const brouillon = imports.find((i) => i.statut === 'BROUILLON') ?? null;
  const soumis = imports.filter((i) => i.statut !== 'BROUILLON');

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Adhérents"
        description="Fichier des membres de votre organisation : adhérents, bénéficiaires, cartes, statut."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <>
          <AdherentsListe
            adherents={adherents}
            souscripteurs={souscripteurs}
            polices={polices}
            peutCreer={peutGererMembres(roleChain)}
            basePath={basePath}
            souscripteurVerrou={societeId}
            verdicts={verdicts}
            estSociete={roleChain.every((r) => !r.startsWith('ASSUREUR_'))}
          />
          {peutProposer && societeId && (
            <PropositionsAdherentsPanel
              souscripteurId={societeId}
              brouillon={brouillon}
              soumis={soumis}
              adherents={adherents}
            />
          )}
        </>
      )}
    </div>
  );
}
