'use client';

import { useRouter } from 'next/navigation';

import { reactiverPerimetre } from '@/app/dashboard-assureur/informatique/utilisateurs/actions';
import { ConfirmationAction } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

/** Compte désactivé par l'archivage d'un périmètre, tel que listé dans la confirmation. */
export interface CompteDesactiveResume {
  id: string;
  email: string | null;
  role: string | null;
}

/**
 * « Tout réactiver » (ADR-007, lot 4) : après le DÉSARCHIVAGE d'un établissement, d'une
 * pharmacie ou d'une société, rétablit en une action les comptes que l'archivage avait
 * désactivés (le désarchivage, lui, ne les réactive jamais). La confirmation LISTE les comptes.
 * Les comptes révoqués à la main n'en font pas partie. Le serveur refuse tant que le périmètre
 * est archivé.
 */
export function ToutReactiver({
  cible,
  id,
  nom,
  comptes,
}: {
  cible: 'etablissement' | 'pharmacie' | 'societe';
  id: string;
  nom: string;
  comptes: CompteDesactiveResume[];
}) {
  const router = useRouter();
  if (comptes.length === 0) return null;
  const liste = comptes.map((c) => `${c.email ?? c.id}${c.role ? ` (${c.role})` : ''}`).join(', ');
  return (
    <ConfirmationAction
      action="desarchiver"
      libelles={{ titre: 'Tout réactiver', bouton: 'Tout réactiver', verbe: 'réactiver' }}
      element={`les ${comptes.length} compte${comptes.length > 1 ? 's' : ''} désactivé${comptes.length > 1 ? 's' : ''} de « ${nom} »`}
      consequence={`Comptes concernés : ${liste}. Ils pourront de nouveau se connecter. Les comptes révoqués à la main ne sont pas touchés.`}
      onConfirmer={() => reactiverPerimetre(cible, id)}
      onSucces={() => router.refresh()}
      declencheur={
        <Button type="button" size="xs" variant="outline">
          Tout réactiver ({comptes.length})
        </Button>
      }
    />
  );
}
