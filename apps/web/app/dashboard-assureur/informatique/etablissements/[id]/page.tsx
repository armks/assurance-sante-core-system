import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import {
  TarifsConventionnesPanneau,
  type ActeDisponible,
  type TarifConventionne,
} from '@/components/dashboard/tarifs-conventionnes-panneau';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { peutSupprimerDefinitivement, verdictsListe } from '@/app/dependances-actions';
import { apiFetch } from '@/lib/api';
import {
  LIBELLE_STATUT_ETABLISSEMENT,
  libelleTypeEtablissement,
} from '@/lib/reseau';

export const metadata: Metadata = { title: 'Établissement — Assurance Informatique' };

interface EtablissementDetail {
  id: string;
  nom: string;
  code: string;
  typeEtablissement: string;
  ville: string | null;
  commune: string | null;
  statut: string;
}

export default async function EtablissementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [resEtab, resTarifs, resActes] = await Promise.all([
    apiFetch(`/api/v1/provider/etablissements/${id}`),
    apiFetch(`/api/v1/provider/etablissements/${id}/tarifs`),
    apiFetch('/api/v1/reference/actes'),
  ]);
  if (resEtab.status === 404) notFound();
  const etablissement = (await resEtab.json()) as EtablissementDetail;
  const tarifs: TarifConventionne[] = resTarifs.ok ? await resTarifs.json() : [];
  const actes: ActeDisponible[] = resActes.ok ? await resActes.json() : [];
  const [verdicts, peutSupprimer] = await Promise.all([
    verdictsListe('tarif', tarifs.map((t) => t.id)),
    peutSupprimerDefinitivement(),
  ]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/etablissements">
          <ArrowLeft className="size-4" />
          Établissements
        </Link>
      </Button>

      <PageTitre
        titre={etablissement.nom}
        action={
          <StatutBadge
            statut={etablissement.statut}
            libelles={LIBELLE_STATUT_ETABLISSEMENT}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1.5 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 py-1">
            <span className="text-muted-foreground">Code</span>
            <span className="font-medium">{etablissement.code}</span>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <span className="text-muted-foreground">Type</span>
            <span className="font-medium">
              {libelleTypeEtablissement(etablissement.typeEtablissement)}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <span className="text-muted-foreground">Localisation</span>
            <span className="font-medium">
              {[etablissement.commune, etablissement.ville].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tarifs conventionnés</CardTitle>
        </CardHeader>
        <CardContent>
          <TarifsConventionnesPanneau
            cible="etablissement"
            cibleId={etablissement.id}
            tarifs={tarifs}
            actesDisponibles={actes}
            verdicts={verdicts}
            peutSupprimer={peutSupprimer}
          />
        </CardContent>
      </Card>
    </div>
  );
}
