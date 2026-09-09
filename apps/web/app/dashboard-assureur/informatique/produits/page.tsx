import type { Metadata } from 'next';

import { SectionVide } from '@/components/section-vide';

export const metadata: Metadata = { title: 'Produits — Assurance Informatique' };

export default function Produits() {
  return (
    <SectionVide
      titre="Produits"
      description="Formules d’assurance versionnées et garanties. Consommera GET /api/v1/plan/produits."
    />
  );
}
