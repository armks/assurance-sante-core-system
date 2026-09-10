import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard/shell';
import { EcranMessage } from '@/components/ecran-message';
import { exigerIdentite } from '@/lib/identity';

const ROUTE_SOCIETE = '/dashboard-societe';

/**
 * Layout du dashboard « société affiliée ». Garde : session + entité
 * SOCIETE_AFFILIEE + rôle provisionné. Nav commune ; chaque écran retire ensuite
 * les actions selon le rôle (SOCIETE_ADMINISTRATION gère le fichier des membres
 * de son propre souscripteur — cohérent avec la RLS `adherents_ecriture`).
 */
export default async function DashboardSocieteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite(ROUTE_SOCIETE);

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
  if (profil.entite !== 'SOCIETE_AFFILIEE') {
    redirect('/dashboard');
  }

  return (
    <DashboardShell
      email={etat.email}
      role={profil.role}
      libelleRole={profil.libelleRole}
      entite={profil.entite}
      niveauAcces={permissions.niveauAcces}
      peutValider={permissions.peutValider}
      dashboardRoute={ROUTE_SOCIETE}
    >
      {children}
    </DashboardShell>
  );
}
