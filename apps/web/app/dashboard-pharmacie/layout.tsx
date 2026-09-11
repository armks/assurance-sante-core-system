import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard/shell';
import { EcranMessage } from '@/components/ecran-message';
import { exigerIdentite } from '@/lib/identity';

const ROUTE_PHARMACIE = '/dashboard-pharmacie';

/**
 * Layout du dashboard pharmacie. Garde : session + entité PHARMACIE + compte
 * rattaché à une pharmacie. Contrairement au centre médical (nav commune aux
 * 4 sous-rôles), chaque sous-rôle PHARMACIE_* a sa propre nav (`dashboardRoute`
 * du rôle, sans override) : pharmacien et caissière partagent le même écran de
 * fonction (droits API identiques, vérifié), le comptable a le sien.
 */
export default async function DashboardPharmacieLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite(ROUTE_PHARMACIE);

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
  if (profil.entite !== 'PHARMACIE') {
    redirect(permissions.dashboardRoute ?? '/dashboard');
  }
  if (!permissions.scope.pharmacieId) {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Compte non rattaché à une pharmacie"
        description="Votre profil doit être associé à une pharmacie du réseau pour accéder à cet espace."
      />
    );
  }

  return (
    <DashboardShell
      email={etat.email}
      role={profil.role}
      libelleRole={profil.libelleRole}
      entite={profil.entite}
      niveauAcces={permissions.niveauAcces}
      peutValider={permissions.peutValider}
      dashboardRoute={permissions.dashboardRoute ?? ROUTE_PHARMACIE}
    >
      {children}
    </DashboardShell>
  );
}
