import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  TicketDetail,
  type DossierFacturation,
} from '@/components/dashboard/centre-medical/ticket-detail';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { ROLES_GENERATION_FACTURE, aUnRole } from '@/lib/centre-medical';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Facturation — Parcours de soins' };

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const etat = await exigerIdentite(`/dashboard-centre-medical/comptable/${id}`);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch(`/api/v1/care-episode/dossiers/${id}`);
  if (res.status === 404) notFound();
  const dossier = (await res.json()) as DossierFacturation;

  const peutFacturer = aUnRole(
    etat.identity.permissions.roleChain,
    ROLES_GENERATION_FACTURE,
  );

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-centre-medical/comptable">
          <ArrowLeft className="size-4" />
          Facturation
        </Link>
      </Button>

      <PageTitre
        titre={dossier.numeroTraitement}
        action={<StatutBadge statut={dossier.statut} />}
      />

      <TicketDetail dossier={dossier} peutFacturer={peutFacturer} />
    </div>
  );
}
