import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { LIBELLE_STATUT_CONVENTION, TON_STATUT_CONVENTION, type ConventionResume } from '@/lib/conventions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  latitude: number | null;
  longitude: number | null;
}

export default async function EtablissementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [resEtab, resConventions] = await Promise.all([
    apiFetch(`/api/v1/provider/etablissements/${id}`),
    apiFetch(`/api/v1/conventions?etablissementId=${id}`),
  ]);
  if (resEtab.status === 404) notFound();
  const etablissement = (await resEtab.json()) as EtablissementDetail;
  const conventions: ConventionResume[] = resConventions.ok ? await resConventions.json() : [];

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
          <div className="flex justify-between gap-4 py-1">
            <span className="text-muted-foreground">Position</span>
            <span className="font-medium">
              {etablissement.latitude != null && etablissement.longitude != null ? (
                `${etablissement.latitude.toFixed(4)}, ${etablissement.longitude.toFixed(4)}`
              ) : (
                <span title="Le géocodage automatique a échoué (ou l’adresse manque) : saisissez la latitude et la longitude à la main depuis la liste (Modifier).">
                  <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                    Position non résolue
                  </Badge>
                </span>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conventions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Les tarifs de l’établissement se négocient et se valident dans sa convention (valeurs par lettre-clé, exceptions par acte, document signé).
          </p>
          {conventions.length === 0 ? (
            <p className="font-medium text-amber-700 dark:text-amber-400">Aucune convention : l’établissement est sans convention validée.</p>
          ) : (
            <ul className="space-y-1">
              {conventions.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span>
                    <span className="font-medium">{c.numero}</span> · version {c.version}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {new Date(c.dateDebut).toLocaleDateString('fr-FR')} → {c.dateFin ? new Date(c.dateFin).toLocaleDateString('fr-FR') : 'sans fin'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatutBadge statut={c.statut} map={TON_STATUT_CONVENTION} libelles={LIBELLE_STATUT_CONVENTION} />
                    <Button asChild size="xs" variant="ghost">
                      <Link href={`/dashboard-assureur/informatique/conventions/${c.id}`}>Ouvrir</Link>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard-assureur/informatique/conventions">Toutes les conventions</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
