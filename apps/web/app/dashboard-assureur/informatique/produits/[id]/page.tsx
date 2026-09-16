import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ProduitDetail,
  type ProduitAvecGaranties,
} from '@/components/dashboard/produit-detail';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Produit — Assurance Informatique' };

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  PUBLIE: 'Publié',
  ARCHIVE: 'Archivé',
};

export default async function ProduitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [etat, res] = await Promise.all([
    exigerIdentite(`/dashboard-assureur/informatique/produits/${id}`),
    apiFetch(`/api/v1/plan/produits/${id}`),
  ]);
  if (res.status === 404) notFound();
  const produit = (await res.json()) as ProduitAvecGaranties;
  // Miroir exact de ROLES_GESTION_PLAN côté API (plan.types.ts) — jamais
  // peutValider, qui reflète une tout autre habilitation (validation
  // d'invitations) et vaut `true` pour des rôles comme ASSUREUR_COMPTABLE.
  const roleChain = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];
  const peutGererPlan = roleChain.some((r) =>
    ['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'].includes(r),
  );

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/produits">
          <ArrowLeft className="size-4" />
          Produits
        </Link>
      </Button>

      <PageTitre
        titre={`${produit.nom} · v${produit.version}`}
        action={
          <StatutBadge
            statut={produit.statut}
            libelle={LIBELLE_STATUT[produit.statut]}
          />
        }
      />

      <ProduitDetail produit={produit} peutGererPlan={peutGererPlan} />
    </div>
  );
}
