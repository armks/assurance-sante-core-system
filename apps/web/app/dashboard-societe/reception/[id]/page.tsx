import type { Metadata } from 'next';

import { AdherentSocieteDetail } from '@/components/dashboard/adherents/adherent-societe-detail';

export const metadata: Metadata = { title: 'Adhérent — Réception' };

const BASE = '/dashboard-societe/reception';

export default async function ReceptionAdherentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdherentSocieteDetail id={id} basePath={BASE} />;
}
