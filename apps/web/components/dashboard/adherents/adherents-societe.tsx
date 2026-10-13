import Link from 'next/link';
import { redirect } from 'next/navigation';

import { verdictsListe } from '@/app/dependances-actions';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { Button } from '@/components/ui/button';
import { peutGererMembres, peutInviterAdherent, peutProposerMembres } from '@/lib/member';
import { AdherentsListe } from './adherents-liste';
import { PropositionsMembresPanel } from './propositions-membres-panel';
import type { AdherentListe, OptionRef, PoliceRef, PropositionMembre } from './types';

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

  const [resA, resS, resP, resM] = await Promise.all([
    apiFetch('/api/v1/member/adherents'),
    apiFetch('/api/v1/tenant/souscripteurs'),
    apiFetch('/api/v1/policy/polices'),
    apiFetch('/api/v1/member/propositions-membres'),
  ]);
  const adherents: AdherentListe[] = resA.ok ? await resA.json() : [];
  const erreur = resA.ok ? null : await messageErreur(resA);
  const souscripteurs: OptionRef[] = resS.ok ? await resS.json() : [];
  const polices: PoliceRef[] = resP.ok ? await resP.json() : [];
  const propositions: PropositionMembre[] = resM.ok ? await resM.json() : [];
  const verdicts = await verdictsListe('adherent', adherents.map((a) => a.id));
  // Formule rattachée = police ACTIVE de la société ; bénéficiaire = rattaché à un titulaire actif.
  const policesActives = polices.filter((p) => p.statut === 'ACTIVE');
  const titulaires = adherents.filter((a) => a.statut === 'ACTIF');

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
            peutInviter={peutInviterAdherent(roleChain)}
          />
          {societeId && (
            <PropositionsMembresPanel
              mode="societe"
              propositions={propositions}
              polices={policesActives}
              adherents={titulaires}
              basePathFiche={basePath}
              peutProposer={peutProposer}
            />
          )}
          {peutProposer && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
              <span className="text-muted-foreground">
                Fichier d’entrants ou de sortants (Excel), sorties individuelles :
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard-societe/administration/mouvements">Entrants / sortants</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
