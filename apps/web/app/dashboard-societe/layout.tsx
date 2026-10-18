import { blocageLicence } from '@/components/licence/blocage-licence';
import { redirect } from 'next/navigation';

import { DashboardShell } from '@/components/dashboard/shell';
import { resumeUtilisateur } from '@/components/dashboard/utilisateur-resume';
import { EcranMessage } from '@/components/ecran-message';
import { exigerIdentite } from '@/lib/identity';
import { CategoriesActeProvider } from '@/components/categories-acte';
import { chargerCategoriesActe } from '@/lib/categories-acte';

const ROUTE_SOCIETE = '/dashboard-societe';

/**
 * Layout du dashboard « société affiliée ». Garde : session + entité
 * SOCIETE_AFFILIEE + rôle provisionné. La nav est propre à chaque rôle (clé =
 * sa `dashboardRoute` réelle — administration / assurée / comptable /
 * réception) : chaque écran retire ensuite ses actions selon le rôle
 * (SOCIETE_ADMINISTRATION gère le fichier des membres de son propre
 * souscripteur — cohérent avec la RLS `adherents_ecriture` — les 3 autres
 * rôles n'y ont accès qu'en lecture).
 */
export default async function DashboardSocieteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lancé en parallèle de l'identité : les deux appels ne s'enchaînent plus
  const categories = chargerCategoriesActe();
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
  // licence de la société non active : fenêtre d'activation (informatique / direction) ou message d'accès suspendu
  const blocage = blocageLicence(etat.identity);
  if (blocage) return blocage;
  if (profil.entite !== 'SOCIETE_AFFILIEE') {
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
      dashboardRoute={permissions.dashboardRoute ?? ROUTE_SOCIETE}
    >
      <CategoriesActeProvider categories={await categories}>
        {children}
      </CategoriesActeProvider>
    </DashboardShell>
  );
}
