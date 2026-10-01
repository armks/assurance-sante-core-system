import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  DossierDetail,
  type DossierComplet,
} from '@/components/dashboard/centre-medical/dossier-detail';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Dossier de soins — Parcours de soins' };

export default async function DossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const etat = await exigerIdentite(`/dashboard-centre-medical/medecin/${id}`);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [res, resActes] = await Promise.all([
    apiFetch(`/api/v1/care-episode/dossiers/${id}`),
    apiFetch('/api/v1/reference/actes?statut=HOMOLOGUE'),
  ]);
  if (res.status === 404) notFound();
  const dossier = (await res.json()) as DossierComplet;
  const actesDisponibles: { id: string; code: string; libelle: string }[] =
    resActes.ok ? await resActes.json() : [];

  const { profil, permissions } = etat.identity;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-centre-medical/medecin">
          <ArrowLeft className="size-4" />
          Dossiers de soins
        </Link>
      </Button>

      <PageTitre
        titre={dossier.numeroTraitement}
        action={<StatutBadge statut={dossier.statut} />}
      />

      <DossierDetail
        dossier={dossier}
        moiId={profil.id}
        role={profil.role ?? ''}
        roleChain={permissions.roleChain}
        actesDisponibles={actesDisponibles}
      />
    </div>
  );
}
