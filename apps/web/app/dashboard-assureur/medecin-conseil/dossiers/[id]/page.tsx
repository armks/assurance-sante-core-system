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

export const metadata: Metadata = { title: 'Dossier de soins — Médecin Conseil' };

/** care-episode.types.ts, ROLE_CLOTURE_FORCEE — jamais le médecin conseil. */
const ROLE_CLOTURE_FORCEE = 'ASSUREUR_EXPLOITATION';

/** care-episode.types.ts, ROLES_ECRITURE_NOTE_DOSSIER — inclut le médecin conseil. */
const ROLES_ECRITURE_NOTE_DOSSIER = ['ASSUREUR_EXPLOITATION', 'ASSUREUR_MEDECIN_CONSEIL'];

/**
 * Accès en lecture au dossier complet du patient (diagnostic, motif,
 * historique des actes) — nécessaire pour juger une contestation d'acte en
 * connaissance de cause. ASSUREUR_MEDECIN_CONSEIL fait déjà partie de
 * ROLES_LECTURE_DOSSIER_STAFF (care-episode.types.ts), aucun changement API
 * requis. Réutilise `DossierSupervisionDetail`, déjà générique.
 */
export default async function DossierMedecinConseilPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [etat, res] = await Promise.all([
    exigerIdentite('/dashboard-assureur/medecin-conseil'),
    apiFetch(`/api/v1/care-episode/dossiers/${id}`),
  ]);
  if (etat.kind !== 'ok') redirect('/dashboard');
  if (res.status === 404) notFound();
  const dossier = (await res.json()) as DossierSupervisionDetailType;
  const roleChain = etat.identity.permissions.roleChain;
  const peutCloturerForce = roleChain.includes(ROLE_CLOTURE_FORCEE);
  const peutAjouterNote = roleChain.some((r) => ROLES_ECRITURE_NOTE_DOSSIER.includes(r));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/medecin-conseil/contestations">
          <ArrowLeft className="size-4" />
          Contestations d'actes
        </Link>
      </Button>

      <PageTitre
        titre={dossier.numeroTraitement}
        action={<StatutBadge statut={dossier.statut} />}
      />

      <DossierSupervisionDetail
        dossier={dossier}
        peutCloturerForce={peutCloturerForce}
        peutAjouterNote={peutAjouterNote}
      />
    </div>
  );
}
