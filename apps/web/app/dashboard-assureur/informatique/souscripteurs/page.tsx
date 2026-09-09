import type { Metadata } from 'next';

import { SectionVide } from '@/components/section-vide';

export const metadata: Metadata = { title: 'Souscripteurs — Assurance Informatique' };

export default function Souscripteurs() {
  return (
    <SectionVide
      titre="Souscripteurs"
      description="Entreprises, collectivités et souscripteurs individuels. Consommera GET /api/v1/tenant/souscripteurs."
    />
  );
}
