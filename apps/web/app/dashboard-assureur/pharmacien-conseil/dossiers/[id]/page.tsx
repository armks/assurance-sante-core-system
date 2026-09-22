import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  DossierSupervisionDetail,
  type DossierSupervisionDetail as DossierSupervisionDetailType,
} from '@/components/dashboard/exploitation/dossier-supervision-detail';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Dossier de soins — Pharmacien Conseil' };

/**
 * Accès en lecture seule au dossier complet du patient (diagnostic, motif de
 * consultation, historique des actes) — item 1 du mécanisme de contestation :
 * `ASSUREUR_PHARMACIEN_CONSEIL` a rejoint `ROLES_LECTURE_DOSSIER_STAFF`
 * (care-episode.types.ts). Réutilise `DossierSupervisionDetail`, déjà
 * générique, plutôt que de dupliquer l'écran — mais SOUS la route propre à ce
 * rôle (`/dashboard-assureur/informatique/*` reste réservé aux rôles listés
 * dans `ROUTES_ADMIN_ASSUREUR`, que ce rôle ne rejoint pas : il n'a aucun
 * droit sur souscripteurs/polices/utilisateurs). Ni clôture forcée ni ajout
 * de note ne lui sont ouverts (réservés à exploitation/médecin conseil) — les
 * notes déjà présentes restent lisibles, embarquées par l'API sans condition
 * de rôle au-delà de l'accès au dossier lui-même.
 */
export default async function DossierPharmacienConseilPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [etat, res] = await Promise.all([
    exigerIdentite('/dashboard-assureur/pharmacien-conseil'),
    apiFetch(`/api/v1/care-episode/dossiers/${id}`),
  ]);
  if (etat.kind !== 'ok') redirect('/dashboard');
  if (res.status === 404) notFound();
  const dossier = (await res.json()) as DossierSupervisionDetailType;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/pharmacien-conseil/prescriptions">
          <ArrowLeft className="size-4" />
          Prescriptions à examiner
        </Link>
      </Button>

      <PageTitre
        titre={dossier.numeroTraitement}
        action={<StatutBadge statut={dossier.statut} />}
      />

      <DossierSupervisionDetail dossier={dossier} peutCloturerForce={false} peutAjouterNote={false} />
    </div>
  );
}
