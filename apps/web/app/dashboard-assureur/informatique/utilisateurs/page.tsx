import type { Metadata } from 'next';

import { SectionVide } from '@/components/section-vide';

export const metadata: Metadata = { title: 'Utilisateurs — Assurance Informatique' };

export default function Utilisateurs() {
  return (
    <SectionVide
      titre="Utilisateurs"
      description="Provisioning des comptes et invitations."
      note="Section prévue au PROMPT 7. Elle consommera GET /api/v1/identity/roles-proposables (déjà en place) pour n’exposer que les rôles réellement créables."
    />
  );
}
