import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import {
  UtilisateursPanneau,
  type Compte,
  type Invitation,
  type RoleProposable,
} from '@/components/dashboard/utilisateurs-panneau';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Utilisateurs — Assurance Informatique',
};

async function json<T>(path: string): Promise<{ data: T; erreur: string | null }> {
  const res = await apiFetch(path);
  if (!res.ok) {
    return { data: [] as unknown as T, erreur: await messageErreur(res) };
  }
  return { data: (await res.json()) as T, erreur: null };
}

export default async function Utilisateurs() {
  const [roles, comptes, invitations] = await Promise.all([
    json<RoleProposable[]>('/api/v1/identity/roles-proposables'),
    json<Compte[]>('/api/v1/identity/comptes'),
    json<Invitation[]>('/api/v1/invitations'),
  ]);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Utilisateurs"
        description="Comptes de l’organisation et invitations. Les rôles proposés sont ceux que votre rôle est réellement autorisé à créer (regles_provisioning)."
      />
      <UtilisateursPanneau
        roles={roles.data}
        comptes={comptes.data}
        invitations={invitations.data}
        erreur={comptes.erreur}
      />
    </div>
  );
}
