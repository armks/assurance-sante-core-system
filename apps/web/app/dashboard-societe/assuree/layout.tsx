import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Vue d’ensemble — Société' };

/** Garde de l'espace Assurée — seul `SOCIETE_ASSUREE` y accède. */
export default async function AssureeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const etat = await exigerIdentite('/dashboard-societe/assuree');
  if (etat.kind !== 'ok') {
    redirect('/dashboard');
  }
  if (!etat.identity.permissions.roleChain.includes('SOCIETE_ASSUREE')) {
    redirect(etat.identity.permissions.dashboardRoute ?? '/dashboard');
  }
  return <>{children}</>;
}
