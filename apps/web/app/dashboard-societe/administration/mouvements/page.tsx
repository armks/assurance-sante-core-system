import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { MouvementsEcran } from '@/components/dashboard/adherents/mouvements-ecran';
import type { AdherentListe, ImportAdherentsResume } from '@/components/dashboard/adherents/types';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Entrants / sortants — Société' };

export default async function MouvementsPage() {
  const etat = await exigerIdentite('/dashboard-societe/administration/mouvements');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const societeId = etat.identity.permissions.scope.societeId ?? undefined;

  const [resA, resI] = await Promise.all([
    apiFetch('/api/v1/member/adherents'),
    apiFetch('/api/v1/member/imports-adherents'),
  ]);
  const adherents: AdherentListe[] = resA.ok ? await resA.json() : [];
  const erreur = resA.ok ? null : await messageErreur(resA);
  const imports: ImportAdherentsResume[] = resI.ok ? await resI.json() : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Entrants / sortants"
        description="Mouvements de personnel : sortants (effet immédiat après validation) et entrants (effet différé au mois suivant), jusqu'à validation par l'assureur."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <MouvementsEcran
          souscripteurId={societeId ?? ''}
          adherents={adherents}
          roleChain={etat.identity.permissions.roleChain}
          imports={imports.filter((i) => !!i.moisEffet)}
        />
      )}
    </div>
  );
}
