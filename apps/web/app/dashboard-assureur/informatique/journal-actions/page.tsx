import type { Metadata } from 'next';

import { JournalActionsEcran, type FiltresJournalUrl } from '@/components/dashboard/journal-actions-ecran';

export const metadata: Metadata = { title: 'Journal des actions' };

export default async function JournalActions({ searchParams }: { searchParams: Promise<FiltresJournalUrl> }) {
  return <JournalActionsEcran base="/dashboard-assureur/informatique/journal-actions" filtres={await searchParams} />;
}
