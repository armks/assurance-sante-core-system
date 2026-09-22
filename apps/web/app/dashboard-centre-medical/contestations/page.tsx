import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  ContestationsRecuesEcran,
  type ContestationActeRecue,
} from '@/components/dashboard/centre-medical/contestations-recues-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Contestations — Centre Médical' };

export default async function CentreMedicalContestationsPage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/contestations');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/contestation/contestations-actes');
  const contestations: ContestationActeRecue[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Contestations reçues"
        description="Le médecin conseil peut contester un acte/une hospitalisation/une analyse-examen. Répondez avec vos justificatifs avant la date limite."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ContestationsRecuesEcran contestations={contestations} />
      )}
    </div>
  );
}
