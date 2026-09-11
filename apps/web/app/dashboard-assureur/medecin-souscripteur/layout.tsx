import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';
import { ROLE_MEDECIN_SOUSCRIPTEUR } from '@/lib/underwriting';

export const metadata: Metadata = { title: 'Médecin Souscripteur' };

/**
 * Garde de l'espace Médecin Souscripteur — séparation stricte (v10 §3) :
 * SEUL `ASSUREUR_MEDECIN_SOUSCRIPTEUR` y accède. `ASSUREUR_MEDECIN_CONSEIL`
 * (qui liquide les sinistres) n'a aucun accès au questionnaire médical, ni
 * ici ni côté API. Refus = redirection vers son propre dashboard, pas un
 * masquage optimiste.
 */
export default async function MedecinSouscripteurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-assureur/medecin-souscripteur');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  if (
    !etat.identity.permissions.roleChain.includes(ROLE_MEDECIN_SOUSCRIPTEUR)
  ) {
    redirect(etat.identity.permissions.dashboardRoute ?? '/dashboard');
  }
  return <>{children}</>;
}
