import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  ContestationsRecuesEcran,
  type ContestationRecue,
} from '@/components/dashboard/pharmacie/contestations-recues-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Contestations — Pharmacien' };

const CIBLE = '/dashboard-pharmacie/pharmacien/contestations';

export default async function PharmacienContestationsPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/contestation/contestations');
  const contestations: ContestationRecue[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Contestations reçues"
        description="Le pharmacien conseil peut contester une ligne déjà délivrée. Répondez avec vos justificatifs avant la date limite."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ContestationsRecuesEcran contestations={contestations} cible={CIBLE} />
      )}
    </div>
  );
}
