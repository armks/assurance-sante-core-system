import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Réception — Société' };

/**
 * Garde de l'espace Réception — LECTURE_SEULE explicite (niveau posé en
 * base). Seul `SOCIETE_RECEPTION` y accède ; l'écran lui-même (et l'API
 * `member/adherents`) ne lui ouvrent aucune action d'écriture.
 */
export default async function ReceptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-societe/reception');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  if (!etat.identity.permissions.roleChain.includes('SOCIETE_RECEPTION')) {
    redirect(etat.identity.permissions.dashboardRoute ?? '/dashboard');
  }
  return <>{children}</>;
}
