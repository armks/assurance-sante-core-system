import type { Metadata } from 'next';

import { AdherentSocieteDetail } from '@/components/dashboard/adherents/adherent-societe-detail';

export const metadata: Metadata = { title: 'Adhérent — Société' };

const BASE = '/dashboard-societe/administration/adherents';

export default async function AdherentSocietePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdherentSocieteDetail id={id} basePath={BASE} />;
}
