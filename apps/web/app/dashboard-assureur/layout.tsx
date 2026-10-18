import { BandeauLicence } from '@/components/licence/bandeau-licence';
import { blocageLicence } from '@/components/licence/blocage-licence';
import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard/shell';
import { resumeUtilisateur } from '@/components/dashboard/utilisateur-resume';
import { EcranMessage } from '@/components/ecran-message';
import { exigerIdentite } from '@/lib/identity';
import { CategoriesActeProvider } from '@/components/categories-acte';
import { chargerCategoriesActe } from '@/lib/categories-acte';

/**
 * Layout partagé de toutes les routes /dashboard-assureur/*. Charge l'identité,
 * garde l'accès (session + entité ASSUREUR + rôle provisionné) et rend la
 * coquille (sidebar + navigation filtrée par les permissions).
 */
export default async function DashboardAssureurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lancé en parallèle de l'identité : les deux appels ne s'enchaînent plus
  const categories = chargerCategoriesActe();
  const etat = await exigerIdentite('/dashboard');

  if (etat.kind === 'non-provisionne') {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Votre compte n’a pas encore de rôle assigné"
        description="Contactez votre administrateur système pour l’attribution d’un sous-rôle."
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
  // licence de la société non active : fenêtre d'activation (informatique / direction) ou message d'accès suspendu
  const blocage = blocageLicence(etat.identity);
  if (blocage) return blocage;
  if (profil.entite !== 'ASSUREUR') {
    // ce rôle ne relève pas de l'assureur : on le renvoie vers son aiguilleur
    redirect('/dashboard');
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
      dashboardRoute={permissions.dashboardRoute}
    >
      <CategoriesActeProvider categories={await categories}>
        <BandeauLicence
          licence={etat.identity.licence}
          roleChain={permissions.roleChain}
          lien={
            permissions.dashboardRoute === '/dashboard-assureur/informatique' ||
            permissions.dashboardRoute === '/dashboard-assureur/informatique-adjoint' ||
            permissions.dashboardRoute === '/dashboard-assureur/direction'
              ? `${permissions.dashboardRoute}/licence`
              : null
          }
        />
        {children}
      </CategoriesActeProvider>
    </DashboardShell>
  );
}
