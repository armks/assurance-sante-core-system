import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  QuestionnaireDetail,
  type QuestionnaireDetailData,
} from '@/components/dashboard/underwriting/questionnaire-detail';
import { PageTitre } from '@/components/page-titre';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Questionnaire médical — Médecin Souscripteur',
};

export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetch(`/api/v1/underwriting/questionnaires/${id}`);
  if (res.status === 404 || res.status === 403) notFound();
  const questionnaire = (await res.json()) as QuestionnaireDetailData;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/medecin-souscripteur">
          <ArrowLeft className="size-4" />
          Questionnaires
        </Link>
      </Button>

      <PageTitre
        titre={`Questionnaire — ${questionnaire.souscripteur?.nom ?? '—'}`}
        description="Réponses déclarées et décision médicale de souscription."
      />

      <QuestionnaireDetail questionnaire={questionnaire} />
    </div>
  );
}
