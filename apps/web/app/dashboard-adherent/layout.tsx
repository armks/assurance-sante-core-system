import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard/shell';
import { EcranMessage } from '@/components/ecran-message';
import { exigerIdentite } from '@/lib/identity';

const ROUTE_ADHERENT = '/dashboard-adherent';

/**
 * Layout du dashboard adhérent. Garde : session + entité ADHERENT (rôles
 * ADHERENT_TITULAIRE / SOUSCRIPTEUR_INDIVIDUEL). Chaque écran n'appelle que des
 * endpoints scopés côté API sur `ctx.adherentId` du compte connecté — jamais un
 * ID d'un autre adhérent, même direct (voir l'audit de sécurité dédié).
 */
export default async function DashboardAdherentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite(ROUTE_ADHERENT);

  if (etat.kind === 'non-provisionne') {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Votre compte n’a pas encore de rôle assigné"
        description="Contactez l’administrateur de votre assureur."
      />
    );
  }
  if (etat.kind === 'erreur') {
    return (
      <EcranMessage
        tonalite="erreur"
        titre="Impossible de charger votre profil"
        description={`L’API a répondu ${etat.status || '—'} — ${etat.message}`}
      />
    );
  }

  const { profil, permissions } = etat.identity;
  if (profil.entite !== 'ADHERENT') {
    redirect(permissions.dashboardRoute ?? '/dashboard');
  }

  return (
    <DashboardShell
      email={etat.email}
      role={profil.role}
      libelleRole={profil.libelleRole}
      entite={profil.entite}
      niveauAcces={permissions.niveauAcces}
      peutValider={permissions.peutValider}
      dashboardRoute={permissions.dashboardRoute ?? ROUTE_ADHERENT}
    >
      {children}
    </DashboardShell>
  );
}
