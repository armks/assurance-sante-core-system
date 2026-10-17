import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard/shell';
import { resumeUtilisateur } from '@/components/dashboard/utilisateur-resume';
import { EcranMessage } from '@/components/ecran-message';
import { ROUTE_CENTRE_MEDICAL } from '@/lib/centre-medical';
import { exigerIdentite } from '@/lib/identity';
import { CategoriesActeProvider } from '@/components/categories-acte';
import { chargerCategoriesActe } from '@/lib/categories-acte';

/**
 * Layout partagé du dashboard « centre médical » (parcours de soins côté
 * établissement). Garde : session + entité CENTRE_MEDICAL + rôle provisionné +
 * compte rattaché à un établissement. La nav est commune aux 4 sous-rôles
 * (accueil / médecin / administratif / comptable) ; chaque écran retire ensuite
 * les actions non autorisées pour le rôle connecté.
 */
export default async function DashboardCentreMedicalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lancé en parallèle de l'identité : les deux appels ne s'enchaînent plus
  const categories = chargerCategoriesActe();
  const etat = await exigerIdentite(ROUTE_CENTRE_MEDICAL);

  if (etat.kind === 'non-provisionne') {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Votre compte n’a pas encore de rôle assigné"
        description="Contactez l’informatique de votre assureur pour l’attribution d’un sous-rôle."
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
  if (profil.entite !== 'CENTRE_MEDICAL') {
    redirect('/dashboard');
  }
  if (!permissions.scope.etablissementId) {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Compte non rattaché à un établissement"
        description="Votre profil doit être associé à un établissement de santé pour accéder au parcours de soins."
      />
    );
  }

  return (
    <DashboardShell
      email={etat.email}
      utilisateur={resumeUtilisateur(profil, etat.email)}
      role={profil.role}
      libelleRole={profil.libelleRole}
      entite={profil.entite}
      niveauAcces={permissions.niveauAcces}
      peutValider={permissions.peutValider}
      dashboardRoute={ROUTE_CENTRE_MEDICAL}
    >
      <CategoriesActeProvider categories={await categories}>
        {children}
      </CategoriesActeProvider>
    </DashboardShell>
  );
}
