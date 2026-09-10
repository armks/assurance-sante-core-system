import { PageTitre } from '@/components/page-titre';
import {
  ActionsLicence,
  CreerSocieteFlow,
} from '@/components/superadmin/societes-forms';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch, messageErreur } from '@/lib/api';

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
  licence: Licence | null;
}

export default async function Societes() {
  const res = await apiFetch('/api/v1/identity/organisations');
  const organisations: Organisation[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

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
                      Licence {org.licence.statut}
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
                  <Badge variant="outline">{org.statut}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ActionsLicence
                organisationId={org.id}
                organisationNom={org.nom}
              />
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
