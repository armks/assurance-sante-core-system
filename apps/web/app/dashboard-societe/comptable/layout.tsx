import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Comptable — Société' };

/** Garde de l'espace Comptable — seul `SOCIETE_COMPTABLE` y accède. */
export default async function ComptableLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-societe/comptable');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  if (!etat.identity.permissions.roleChain.includes('SOCIETE_COMPTABLE')) {
    redirect(etat.identity.permissions.dashboardRoute ?? '/dashboard');
  }
  return <>{children}</>;
}
