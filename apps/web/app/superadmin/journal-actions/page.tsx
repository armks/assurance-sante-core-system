import type { Metadata } from 'next';

import { JournalActionsEcran, type FiltresJournalUrl } from '@/components/dashboard/journal-actions-ecran';

export const metadata: Metadata = { title: 'Journal des actions — Super administration' };

/** Toutes les organisations : le superadministrateur voit l'ensemble des traces. */
export default async function JournalActionsSuperadmin({ searchParams }: { searchParams: Promise<FiltresJournalUrl> }) {
  return <JournalActionsEcran base="/superadmin/journal-actions" filtres={await searchParams} />;
}
