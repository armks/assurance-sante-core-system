import type { Metadata } from 'next';

import { ParametresImpressionPage } from '@/components/impression/parametres-impression-page';

export const metadata: Metadata = { title: 'Impression des reçus — Centre médical' };

export default function Page() {
  return <ParametresImpressionPage racine="/dashboard-centre-medical/parametres-impression" lieu="votre établissement" />;
}
