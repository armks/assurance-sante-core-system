import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import {
  UtilisateursPanneau,
  type Compte,
  type Invitation,
  type RoleProposable,
} from '@/components/dashboard/utilisateurs-panneau';
import { verdictsListe } from '@/app/dependances-actions';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

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
  const etat = await exigerIdentite('/dashboard-assureur/informatique/utilisateurs');
  const peutValider =
    etat.kind === 'ok' ? etat.identity.permissions.peutValider : false;

  const [roles, comptes, invitations, etablissements, pharmacies, souscripteurs] =
    await Promise.all([
      json<RoleProposable[]>('/api/v1/identity/roles-proposables'),
      json<Compte[]>('/api/v1/identity/comptes'),
      json<Invitation[]>('/api/v1/invitations'),
      json<{ id: string; nom: string }[]>('/api/v1/provider/etablissements'),
      json<{ id: string; nom: string }[]>('/api/v1/provider/pharmacies'),
      json<{ id: string; nom: string }[]>('/api/v1/tenant/souscripteurs'),
    ]);

  const verdicts = {
    ...(await verdictsListe('utilisateur', comptes.data.map((c) => c.id))),
    ...(await verdictsListe('invitation', invitations.data.filter((i) => i.statut === 'REVOQUEE' || i.statut === 'EXPIREE').map((i) => i.id))),
  };

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
        peutValider={peutValider}
        etablissements={etablissements.data}
        pharmacies={pharmacies.data}
        souscripteurs={souscripteurs.data}
        verdicts={verdicts}
      />
    </div>
  );
}
