import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { CartesSouscripteur } from '@/components/dashboard/cartes-souscripteur';
import { ComiteGestion } from '@/components/dashboard/comite-gestion';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

export const metadata: Metadata = { title: 'Souscripteur — Assurance Informatique' };

interface MembreComite {
  id: string;
  userId: string;
  fonction: string;
  dateDebutMandat: string | null;
  dateFinMandat: string | null;
}
interface Souscripteur {
  id: string;
  type: 'ENTREPRISE' | 'COLLECTIVITE' | 'INDIVIDUEL';
  nom: string;
  secteurActivite: string | null;
  effectifDeclare: number | null;
  typeCollectivite: string | null;
  organeGouvernance: string | null;
  subventionExterne: boolean;
  bailleurSubvention: string | null;
  numeroPieceIdentite: string | null;
  statut?: 'ACTIF' | 'ARCHIVE';
  createdAt: string;
  membresComite: MembreComite[];
}
interface Compte {
  id: string;
  email: string | null;
  libelleRole: string | null;
}

const LIBELLE_TYPE: Record<string, string> = {
  ENTREPRISE: 'Entreprise',
  COLLECTIVITE: 'Collectivité',
  INDIVIDUEL: 'Individuel',
};

function Ligne({ label, valeur }: { label: string; valeur: React.ReactNode }) {
  if (valeur == null || valeur === '') return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{valeur}</span>
    </div>
  );
}

export default async function SouscripteurDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetch(`/api/v1/tenant/souscripteurs/${id}`);
  if (res.status === 404) notFound();
  const s = (await res.json()) as Souscripteur;

  const comptesRes =
    s.type === 'COLLECTIVITE'
      ? await apiFetch('/api/v1/identity/comptes')
      : null;
  const comptes: Compte[] =
    comptesRes && comptesRes.ok ? await comptesRes.json() : [];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/souscripteurs">
          <ArrowLeft className="size-4" />
          Souscripteurs
        </Link>
      </Button>

      <PageTitre
        titre={s.nom}
        action={
          <span className="flex items-center gap-2">
            <StatutBadge
              statut={s.type}
              ton="info"
              libelle={LIBELLE_TYPE[s.type]}
            />
            {s.statut === 'ARCHIVE' && <StatutBadge statut="ARCHIVE" ton="neutre" libelle="Archivée" />}
          </span>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Ligne label="Créé le" valeur={new Date(s.createdAt).toLocaleDateString('fr-FR')} />
          {s.type === 'ENTREPRISE' && (
            <>
              <Ligne label="Secteur d’activité" valeur={s.secteurActivite} />
              <Ligne
                label="Effectif déclaré"
                valeur={s.effectifDeclare != null ? `${s.effectifDeclare}` : null}
              />
            </>
          )}
          {s.type === 'COLLECTIVITE' && (
            <>
              <Ligne label="Type de collectivité" valeur={s.typeCollectivite} />
              <Ligne label="Organe de gouvernance" valeur={s.organeGouvernance} />
              <Ligne
                label="Subvention externe"
                valeur={s.subventionExterne ? 'Oui' : 'Non'}
              />
              <Ligne label="Bailleur" valeur={s.bailleurSubvention} />
            </>
          )}
          {s.type === 'INDIVIDUEL' && (
            <Ligne label="Pièce d’identité" valeur={s.numeroPieceIdentite} />
          )}
        </CardContent>
      </Card>

      {s.type === 'COLLECTIVITE' && (
        <ComiteGestion
          souscripteurId={s.id}
          membres={s.membresComite ?? []}
          comptes={comptes}
        />
      )}

      <CartesSouscripteur souscripteurId={s.id} />
    </div>
  );
}
