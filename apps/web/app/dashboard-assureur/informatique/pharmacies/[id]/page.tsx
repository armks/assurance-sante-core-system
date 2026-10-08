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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { peutSupprimerDefinitivement, verdictsListe } from '@/app/dependances-actions';
import { apiFetch } from '@/lib/api';
import { LIBELLE_STATUT_PHARMACIE } from '@/lib/reseau';

export const metadata: Metadata = { title: 'Pharmacie — Assurance Informatique' };

interface PharmacieDetail {
  id: string;
  nom: string;
  code: string;
  ville: string | null;
  commune: string | null;
  statut: string;
  latitude: number | null;
  longitude: number | null;
}

export default async function PharmaciePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [resPharma, resTarifs, resActes] = await Promise.all([
    apiFetch(`/api/v1/provider/pharmacies/${id}`),
    apiFetch(`/api/v1/provider/pharmacies/${id}/tarifs`),
    apiFetch('/api/v1/reference/actes'),
  ]);
  if (resPharma.status === 404) notFound();
  const pharmacie = (await resPharma.json()) as PharmacieDetail;
  const tarifs: TarifConventionne[] = resTarifs.ok ? await resTarifs.json() : [];
  const actes: ActeDisponible[] = resActes.ok ? await resActes.json() : [];
  const [verdicts, peutSupprimer] = await Promise.all([
    verdictsListe('tarif', tarifs.map((t) => t.id)),
    peutSupprimerDefinitivement(),
  ]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/pharmacies">
          <ArrowLeft className="size-4" />
          Pharmacies
        </Link>
      </Button>

      <PageTitre
        titre={pharmacie.nom}
        action={
          <StatutBadge
            statut={pharmacie.statut}
            libelles={LIBELLE_STATUT_PHARMACIE}
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
            <span className="font-medium">{pharmacie.code}</span>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <span className="text-muted-foreground">Localisation</span>
            <span className="font-medium">
              {[pharmacie.commune, pharmacie.ville].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <span className="text-muted-foreground">Position</span>
            <span className="font-medium">
              {pharmacie.latitude != null && pharmacie.longitude != null ? (
                `${pharmacie.latitude.toFixed(4)}, ${pharmacie.longitude.toFixed(4)}`
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
          <CardTitle className="text-base">Tarifs conventionnés</CardTitle>
        </CardHeader>
        <CardContent>
          <TarifsConventionnesPanneau
            cible="pharmacie"
            cibleId={pharmacie.id}
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
