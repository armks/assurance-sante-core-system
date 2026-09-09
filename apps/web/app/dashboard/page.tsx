import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { EcranMessage } from '@/components/ecran-message';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = {
  title: 'Redirection…',
};

/**
 * Aiguilleur : appelle GET /api/v1/identity/me puis redirige vers la
 * `dashboardRoute` du rôle. Affiche un écran clair si le compte n'a pas de rôle.
 */
export default async function Dashboard() {
  const etat = await exigerIdentite('/dashboard');

  if (etat.kind === 'non-provisionne') {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Votre compte n’a pas encore de rôle assigné"
        description="Un administrateur doit vous attribuer un sous-rôle pour que vous puissiez accéder à votre espace. Contactez votre administrateur système."
      >
        <p className="text-muted-foreground">
          Connecté en tant que <span className="font-medium text-foreground">{etat.email}</span>.
        </p>
      </EcranMessage>
    );
  }

  if (etat.kind === 'erreur') {
    return (
      <EcranMessage
        tonalite="erreur"
        titre="Impossible de charger votre profil"
        description={`L’API a répondu ${etat.status || '—'} — ${etat.message}`}
      >
        <p className="text-muted-foreground">
          Réessayez dans un instant. Si le problème persiste, prévenez le support.
        </p>
      </EcranMessage>
    );
  }

  const route = etat.identity.permissions.dashboardRoute;
  if (route && route !== '/dashboard') {
    redirect(route);
  }

  return (
    <EcranMessage
      tonalite="attention"
      titre="Aucun tableau de bord n’est configuré pour votre rôle"
      description={`Rôle : ${etat.identity.profil.libelleRole ?? etat.identity.profil.role ?? '—'}. L’interface de ce rôle n’est pas encore disponible.`}
    />
  );
}
