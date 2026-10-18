import type { Metadata } from 'next';

import { ParametresImpressionPage } from '@/components/impression/parametres-impression-page';

export const metadata: Metadata = { title: 'Impression des reçus — Pharmacie' };

export default function Page() {
  return <ParametresImpressionPage racine="/dashboard-pharmacie/pharmacien/parametres-impression" lieu="votre pharmacie" />;
}
