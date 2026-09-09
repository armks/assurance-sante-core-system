import type { Metadata } from 'next';

import { SectionVide } from '@/components/section-vide';

export const metadata: Metadata = { title: 'Polices — Assurance Informatique' };

export default function Polices() {
  return (
    <SectionVide
      titre="Polices"
      description="Contrats, machine à états et avenants. Consommera GET /api/v1/policy/polices."
    />
  );
}
