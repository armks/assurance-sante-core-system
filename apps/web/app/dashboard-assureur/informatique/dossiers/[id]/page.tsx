import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  DossierSupervisionDetail,
  type DossierSupervisionDetail as DossierSupervisionDetailType,
} from '@/components/dashboard/exploitation/dossier-supervision-detail';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { LIBELLE_STATUT_DOSSIER } from '@/lib/dossier-soins';

export const metadata: Metadata = { title: 'Dossier de soins — Assurance Exploitation' };

/** Droit exclusif côté API — care-episode.types.ts, ROLE_CLOTURE_FORCEE. */
const ROLE_CLOTURE_FORCEE = 'ASSUREUR_EXPLOITATION';

/** care-episode.types.ts, ROLES_ECRITURE_NOTE_DOSSIER. */
const ROLES_ECRITURE_NOTE_DOSSIER = ['ASSUREUR_EXPLOITATION', 'ASSUREUR_MEDECIN_CONSEIL'];

export default async function DossierSupervisionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [etat, res, resEtabs] = await Promise.all([
    exigerIdentite(`/dashboard-assureur/informatique/dossiers/${id}`),
    apiFetch(`/api/v1/care-episode/dossiers/${id}`),
    // réorientation proposée dans la décision d'exploitation
    apiFetch('/api/v1/provider/etablissements?statut=ACTIF'),
  ]);
  if (res.status === 404) notFound();
  const dossier = (await res.json()) as DossierSupervisionDetailType;
  const roleChain = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];
  const etablissements: { id: string; nom: string }[] = resEtabs.ok ? await resEtabs.json() : [];
  const moiId = etat.kind === 'ok' ? etat.identity.profil.id : '';
  const peutCloturerForce = roleChain.includes(ROLE_CLOTURE_FORCEE);
  const peutAjouterNote = roleChain.some((r) => ROLES_ECRITURE_NOTE_DOSSIER.includes(r));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/dossiers">
          <ArrowLeft className="size-4" />
          Dossiers de soins
        </Link>
      </Button>

      <PageTitre
        titre={dossier.numeroTraitement}
        action={
          <StatutBadge
            statut={dossier.statut}
            libelles={LIBELLE_STATUT_DOSSIER}
          />
        }
      />

      <DossierSupervisionDetail
        dossier={dossier}
        peutCloturerForce={peutCloturerForce}
        peutAjouterNote={peutAjouterNote}
        roleChain={roleChain}
        moiId={moiId}
        etablissements={etablissements}
      />
    </div>
  );
}
