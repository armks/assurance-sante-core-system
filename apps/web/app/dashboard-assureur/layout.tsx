import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard/shell';
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
  if (profil.entite !== 'ASSUREUR') {
    // ce rôle ne relève pas de l'assureur : on le renvoie vers son aiguilleur
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
      dashboardRoute={permissions.dashboardRoute}
    >
      <CategoriesActeProvider categories={await chargerCategoriesActe()}>
        {children}
      </CategoriesActeProvider>
    </DashboardShell>
  );
}
