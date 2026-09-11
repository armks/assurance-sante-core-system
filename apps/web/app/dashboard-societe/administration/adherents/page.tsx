import type { Metadata } from 'next';

import { AdherentsSociete } from '@/components/dashboard/adherents/adherents-societe';

export const metadata: Metadata = { title: 'Adhérents — Société' };

export default function AdherentsSocietePage() {
  return (
    <AdherentsSociete basePath="/dashboard-societe/administration/adherents" />
  );
}
