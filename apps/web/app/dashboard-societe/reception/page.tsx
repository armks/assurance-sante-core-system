import type { Metadata } from 'next';

import { AdherentsSociete } from '@/components/dashboard/adherents/adherents-societe';

export const metadata: Metadata = { title: 'Adhérents — Réception' };

export default function ReceptionPage() {
  return <AdherentsSociete basePath="/dashboard-societe/reception" />;
}
