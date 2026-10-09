import type { Metadata } from 'next';

import { PageConventionDetail } from '@/components/dashboard/conventions/conventions-pages';

export const metadata: Metadata = { title: 'Convention' };

export default async function ConventionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PageConventionDetail base="/dashboard-assureur/medecin-conseil" id={id} />;
}
