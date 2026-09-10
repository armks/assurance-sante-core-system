import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  PoliceDetail,
  type ActionsPolice,
  type Police,
} from '@/components/dashboard/police-detail';
import {
  LIBELLE_POLICE,
  TON_POLICE,
} from '@/components/dashboard/polices-ecran';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

export const metadata: Metadata = { title: 'Police — Assurance Informatique' };

export default async function PolicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetch(`/api/v1/policy/polices/${id}`);
  if (res.status === 404) notFound();
  const police = (await res.json()) as Police;

  const resActions = await apiFetch(`/api/v1/policy/polices/${id}/actions`);
  const actions: ActionsPolice = resActions.ok
    ? await resActions.json()
    : { statut: police.statut, transitions: [], actions: [] };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/polices">
          <ArrowLeft className="size-4" />
          Polices
        </Link>
      </Button>

      <PageTitre
        titre={police.numeroPolice}
        action={
          <StatutBadge
            statut={police.statut}
            map={TON_POLICE}
            libelles={LIBELLE_POLICE}
          />
        }
      />

      <PoliceDetail police={police} actions={actions} />
    </div>
  );
}
