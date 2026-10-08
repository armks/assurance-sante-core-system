import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  NouvelleReclamationEcran,
  type ActeReclamable,
} from '@/components/dashboard/reclamations/nouvelle-reclamation-ecran';
import { PageTitre } from '@/components/page-titre';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { peutSoumettreReclamation } from '@/lib/reclamations';

export const metadata: Metadata = { title: 'Nouvelle réclamation — Assurance' };

const CIBLE = '/dashboard-assureur/informatique/reclamations/nouvelle';

export default async function NouvelleReclamationPage({
  searchParams,
}: {
  searchParams: Promise<{ recherche?: string }>;
}) {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');
  // L'API refuserait (403) : on ne montre l'écran qu'aux rôles qui peuvent soumettre.
  if (!peutSoumettreReclamation(etat.identity.permissions.roleChain)) {
    redirect('/dashboard-assureur/informatique/reclamations');
  }

  const { recherche = '' } = await searchParams;
  const res = await apiFetch(
    `/api/v1/claims/reclamations/actes-reclamables${recherche ? `?recherche=${encodeURIComponent(recherche)}` : ''}`,
  );
  const actes: ActeReclamable[] = res.ok ? await res.json() : [];
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
        titre="Nouvelle réclamation"
        description="Demande de remboursement d’un acte payé par le patient. Seuls les actes réalisés, jamais facturés en tiers payant et pas encore réclamés sont proposés ; la décision est rendue immédiatement par le moteur d’adjudication."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <NouvelleReclamationEcran actes={actes} recherche={recherche} />
      )}
    </div>
  );
}
