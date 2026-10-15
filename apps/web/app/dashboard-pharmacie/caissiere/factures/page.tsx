import type { Metadata } from 'next';

import { FacturesSuiviPage } from '@/components/dashboard/pharmacie/factures-suivi-page';
import type { ParametresUrl } from '@/lib/liste-serveur';

export const metadata: Metadata = { title: 'Factures des prescriptions' };

export default async function Page({ searchParams }: { searchParams: Promise<ParametresUrl> }) {
  return <FacturesSuiviPage searchParams={await searchParams} />;
}
