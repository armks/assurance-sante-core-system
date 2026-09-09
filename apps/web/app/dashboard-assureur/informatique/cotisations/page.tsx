import type { Metadata } from 'next';

import { SectionVide } from '@/components/section-vide';

export const metadata: Metadata = { title: 'Cotisations — Assurance Informatique' };

export default function Cotisations() {
  return (
    <SectionVide
      titre="Cotisations"
      description="Grilles tarifaires, appels de cotisation et paiements. Consommera GET /api/v1/billing/cotisations."
    />
  );
}
