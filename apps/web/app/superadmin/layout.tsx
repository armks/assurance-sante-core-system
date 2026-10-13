import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { EcranMessage } from '@/components/ecran-message';
import { resumeUtilisateur } from '@/components/dashboard/utilisateur-resume';
import { SuperadminShell } from '@/components/superadmin/shell';
import { exigerIdentite } from '@/lib/identity';
import { CategoriesActeProvider } from '@/components/categories-acte';
import { chargerCategoriesActe } from '@/lib/categories-acte';

export const metadata: Metadata = {
  title: 'Super administration',
};

const ROLE_SUPERADMIN = 'SUPERADMIN_PRINCIPAL';

/**
 * Espace du superadministrateur : onboarding des organisations et invitation de
 * leur premier compte. Réservé au rôle SUPERADMIN_PRINCIPAL (héritage inclus).
 */
export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/superadmin/societes');

  if (etat.kind === 'non-provisionne') {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Votre compte n’a pas encore de rôle assigné"
        description="Contactez votre administrateur système."
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

  if (!etat.identity.permissions.roleChain.includes(ROLE_SUPERADMIN)) {
    redirect('/dashboard');
  }

  return (
    <SuperadminShell email={etat.email} utilisateur={resumeUtilisateur(etat.identity.profil, etat.email)}>
      <CategoriesActeProvider categories={await chargerCategoriesActe()}>
        {children}
      </CategoriesActeProvider>
    </SuperadminShell>
  );
}
