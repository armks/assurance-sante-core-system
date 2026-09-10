import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdherentsListe } from '@/components/dashboard/adherents/adherents-liste';
import type {
  AdherentListe,
  OptionRef,
  PoliceRef,
} from '@/components/dashboard/adherents/types';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { peutGererMembres } from '@/lib/member';

export const metadata: Metadata = { title: 'Adhérents — Société' };

const BASE = '/dashboard-societe/administration/adherents';

export default async function AdherentsSocietePage() {
  const etat = await exigerIdentite(BASE);
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
          basePath={BASE}
          souscripteurVerrou={societeId}
        />
      )}
    </div>
  );
}
