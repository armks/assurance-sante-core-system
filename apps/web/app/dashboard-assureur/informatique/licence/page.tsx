import type { Metadata } from 'next';

import { LicencePage } from '@/components/licence/licence-page';
import { PageTitre } from '@/components/page-titre';

export const metadata: Metadata = { title: 'Licence — Informatique' };

export default function Licence() {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Licence de la société"
        description="Type de licence, date d’expiration et temps restant avant le renouvellement. Le renouvellement se fait avec un code d’activation temporaire fourni par le support."
      />
      <LicencePage />
    </div>
  );
}
