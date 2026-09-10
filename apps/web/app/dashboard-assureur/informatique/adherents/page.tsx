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

export const metadata: Metadata = { title: 'Adhérents — Assurance Informatique' };

export default async function AdherentsPage() {
  const etat = await exigerIdentite(
    '/dashboard-assureur/informatique/adherents',
  );
  if (etat.kind !== 'ok') redirect('/dashboard');

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
        description="Fichier des membres : adhérents titulaires et bénéficiaires, cartes, statut."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <AdherentsListe
          adherents={adherents}
          souscripteurs={souscripteurs}
          polices={polices}
          peutCreer={peutGererMembres(etat.identity.permissions.roleChain)}
          basePath="/dashboard-assureur/informatique/adherents"
        />
      )}
    </div>
  );
}
