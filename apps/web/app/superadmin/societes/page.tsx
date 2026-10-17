import { headers } from 'next/headers';

import { GraphiquesOrganisations } from '@/components/dashboard/graphiques-roles';
import { PageTitre } from '@/components/page-titre';
import { FileActionsEnAttente } from '@/components/superadmin/file-actions';
import { LogoOrganisation } from '@/components/superadmin/logo-organisation';
import { PagePubliqueOrganisation } from '@/components/superadmin/page-publique-organisation';
import {
  ActionsLicence,
  CreerSocieteFlow,
} from '@/components/superadmin/societes-forms';
import type { ActionEnAttente } from '@/app/superadmin/societes/actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import {
  LIBELLE_STATUT_LICENCE,
  LIBELLE_STATUT_ORGANISATION,
} from '@/lib/organisation';

interface Licence {
  plan: string;
  statut: string;
  limiteAdherents: number | null;
  dateFin: string | null;
}
interface Organisation {
  id: string;
  nom: string;
  type: string;
  pays: string;
  devise: string;
  statut: string;
  createdAt: string;
  logoUrl: string | null;
  slug: string;
  codeAssureur: string;
  licence: Licence | null;
}

export default async function Societes() {
  const [res, resActions, etat] = await Promise.all([
    apiFetch('/api/v1/identity/organisations'),
    apiFetch('/api/v1/superadmin/actions'),
    exigerIdentite('/superadmin/societes'),
  ]);
  // Logo : EXCLUSIVEMENT SUPERADMIN_PRINCIPAL (rôle propre, pas hérité).
  const peutModifierLogo =
    etat.kind === 'ok' && etat.identity.profil.role === 'SUPERADMIN_PRINCIPAL';
  const organisations: Organisation[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);
  const actionsEnAttente: ActionEnAttente[] = resActions.ok
    ? await resActions.json()
    : [];
  // Origine du site telle que vue par le navigateur : URL publique complète
  // des pages /{slug} (domaine de production comme poste de développement).
  const h = await headers();
  const origine = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Sociétés"
        description="Organisations clientes et leurs licences. Toute action sensible (création, suspension, prolongation) se confirme en deux étapes avec un code envoyé par e-mail."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nouvelle organisation</CardTitle>
        </CardHeader>
        <CardContent>
          <CreerSocieteFlow />
        </CardContent>
      </Card>

      <GraphiquesOrganisations organisations={organisations} />

      <FileActionsEnAttente actions={actionsEnAttente} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {organisations.length} organisation{organisations.length > 1 ? 's' : ''}
        </h2>

        {erreur && <p className="text-sm text-destructive">{erreur}</p>}

        {organisations.map((org) => (
          <Card key={org.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{org.nom}</CardTitle>
                <Badge variant="secondary">{org.type}</Badge>
                <Badge variant="outline" title="Code assureur">Code {org.codeAssureur}</Badge>
                <Badge variant="outline">{org.pays}</Badge>
                <Badge variant="muted">{org.devise}</Badge>
                {org.licence ? (
                  <>
                    <Badge variant="secondary">Plan {org.licence.plan}</Badge>
                    <Badge
                      variant={
                        org.licence.statut === 'ACTIVE' ? 'success' : 'outline'
                      }
                    >
                      Licence {LIBELLE_STATUT_LICENCE[org.licence.statut] ?? org.licence.statut}
                    </Badge>
                    {org.licence.dateFin && (
                      <Badge variant="muted">
                        échéance{' '}
                        {new Date(org.licence.dateFin).toLocaleDateString('fr-FR')}
                      </Badge>
                    )}
                  </>
                ) : (
                  <Badge variant="outline">sans licence</Badge>
                )}
                {org.statut !== 'ACTIVE' && (
                  <Badge variant="outline">
                    {LIBELLE_STATUT_ORGANISATION[org.statut] ?? org.statut}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <ActionsLicence
                organisationId={org.id}
                organisationNom={org.nom}
              />
              <section aria-label={`Page d’accueil de ${org.nom}`} className="border-t pt-4">
                <h3 className="mb-3 text-sm font-medium">Page d’accueil publique</h3>
                <PagePubliqueOrganisation
                  organisationId={org.id}
                  slug={org.slug}
                  origine={origine}
                  peutModifier={peutModifierLogo}
                />
              </section>
              <section aria-label={`Logo de ${org.nom}`} className="border-t pt-4">
                <h3 className="mb-3 text-sm font-medium">Logo</h3>
                <LogoOrganisation
                  organisationId={org.id}
                  organisationNom={org.nom}
                  logoUrl={org.logoUrl}
                  peutModifier={peutModifierLogo}
                />
              </section>
            </CardContent>
          </Card>
        ))}

        {!erreur && organisations.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Aucune organisation. Créez-en une ci-dessus.
          </p>
        )}
      </section>
    </div>
  );
}
