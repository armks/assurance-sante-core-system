import type { Metadata } from 'next';

import { PageConventions } from '@/components/dashboard/conventions/conventions-pages';

export const metadata: Metadata = { title: 'Conventions' };

export default function Conventions() {
  return <PageConventions base="/dashboard-assureur/informatique" />;
}
