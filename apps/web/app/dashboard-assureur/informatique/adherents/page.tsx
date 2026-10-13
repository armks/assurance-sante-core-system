import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdherentsListe } from '@/components/dashboard/adherents/adherents-liste';
import { PropositionsMembresPanel } from '@/components/dashboard/adherents/propositions-membres-panel';
import { ImportsAdherentsPanel } from '@/components/dashboard/adherents/imports-adherents-panel';
import { SortantsEnAttentePanel } from '@/components/dashboard/adherents/sortants-en-attente-panel';
import type {
  AdherentListe,
  ImportAdherentsResume,
  OptionRef,
  PoliceRef,
  PropositionMembre,
} from '@/components/dashboard/adherents/types';
import { verdictsListe } from '@/app/dependances-actions';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import {
  peutGererMembres,
  peutImporterAdherents,
  peutInviterAdherent,
  peutValiderImportAdherents,
  peutValiderSortants,
} from '@/lib/member';

export const metadata: Metadata = { title: 'Adhérents — Assurance Informatique' };

export default async function AdherentsPage() {
  const etat = await exigerIdentite(
    '/dashboard-assureur/informatique/adherents',
  );
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resA, resS, resP, resI, resM] = await Promise.all([
    apiFetch('/api/v1/member/adherents'),
    apiFetch('/api/v1/tenant/souscripteurs'),
    apiFetch('/api/v1/policy/polices'),
    apiFetch('/api/v1/member/imports-adherents'),
    apiFetch('/api/v1/member/propositions-membres'),
  ]);
  const adherents: AdherentListe[] = resA.ok ? await resA.json() : [];
  const erreur = resA.ok ? null : await messageErreur(resA);
  const souscripteurs: OptionRef[] = resS.ok ? await resS.json() : [];
  const polices: PoliceRef[] = resP.ok ? await resP.json() : [];
  // 403 attendu pour un rôle sans rapport avec l'import (ex. médecin conseil) —
  // pas une erreur de page, juste un panneau vide pour ce rôle.
  const imports: ImportAdherentsResume[] = resI.ok ? await resI.json() : [];
  // 403 attendu pour un rôle non habilité à lire la file : panneau absent.
  const propositions: PropositionMembre[] = resM.ok ? await resM.json() : [];
  const roleChain = etat.identity.permissions.roleChain;
  const verdicts = await verdictsListe('adherent', adherents.map((a) => a.id));

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Adhérents"
        description="Fichier des membres : adhérents titulaires et bénéficiaires, cartes, statut."
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
            basePath="/dashboard-assureur/informatique/adherents"
            verdicts={verdicts}
            peutInviter={peutInviterAdherent(roleChain)}
          />
          {resM.ok && (
            <PropositionsMembresPanel
              mode="assureur"
              propositions={propositions}
              basePathFiche="/dashboard-assureur/informatique/adherents"
            />
          )}
          {(peutImporterAdherents(roleChain) || peutValiderImportAdherents(roleChain)) && (
            <ImportsAdherentsPanel
              imports={imports}
              souscripteurs={souscripteurs}
              peutImporter={peutImporterAdherents(roleChain)}
              peutValider={peutValiderImportAdherents(roleChain)}
            />
          )}
          {peutValiderSortants(roleChain) && (
            <SortantsEnAttentePanel sortants={adherents.filter((a) => a.statut === 'PROPOSE_SORTANT')} />
          )}
        </>
      )}
    </div>
  );
}
