import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  RevueManuelleFile,
} from '@/components/dashboard/reclamations/revue-manuelle-file';
import type { Reclamation } from '@/components/dashboard/reclamations/reclamations-liste';
import { PageTitre } from '@/components/page-titre';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Revue manuelle — Réclamations' };

export default async function RevueManuellePage() {
  const etat = await exigerIdentite(
    '/dashboard-assureur/informatique/reclamations/revue-manuelle',
  );
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch(
    '/api/v1/claims/reclamations?statut=REVUE_MANUELLE',
  );
  const reclamations: Reclamation[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/reclamations">
          <ArrowLeft className="size-4" />
          Réclamations
        </Link>
      </Button>

      <PageTitre
        titre="File — En revue manuelle"
        description="Réclamations que l’adjudication automatique n’a pas tranchées (montant élevé, plafond). Le traitement est réservé, selon le type, au médecin-conseil ou à l’exploitation."
      />

      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <RevueManuelleFile
          reclamations={reclamations}
          roleChain={etat.identity.permissions.roleChain}
        />
      )}
    </div>
  );
}
