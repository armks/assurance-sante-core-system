import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ReclamationDetail } from '@/components/dashboard/reclamations/reclamation-detail';
import type { Reclamation } from '@/components/dashboard/reclamations/reclamations-liste';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import {
  LIBELLE_STATUT_RECLAMATION,
  TON_STATUT_RECLAMATION,
} from '@/lib/reclamations';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Réclamation — Assurance Informatique' };

export default async function ReclamationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const etat = await exigerIdentite(
    `/dashboard-assureur/informatique/reclamations/${id}`,
  );
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch(`/api/v1/claims/reclamations/${id}`);
  if (res.status === 404) notFound();
  const reclamation = (await res.json()) as Reclamation;

  const rd = await apiFetch(
    `/api/v1/care-episode/dossiers/${reclamation.dossierSoinsId}`,
  );
  const dossier = rd.ok ? await rd.json() : null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/reclamations">
          <ArrowLeft className="size-4" />
          Réclamations
        </Link>
      </Button>

      <PageTitre
        titre={`Réclamation ${reclamation.id.slice(0, 8)}`}
        action={
          <StatutBadge
            statut={reclamation.statut}
            map={TON_STATUT_RECLAMATION}
            libelles={LIBELLE_STATUT_RECLAMATION}
          />
        }
      />

      <ReclamationDetail
        reclamation={reclamation}
        dossier={dossier}
        roleChain={etat.identity.permissions.roleChain}
      />
    </div>
  );
}
