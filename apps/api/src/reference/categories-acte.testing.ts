import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CategorieActe } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from './categories-acte.service';

/**
 * AIDE DE TEST UNIQUEMENT (jamais importée par le code applicatif).
 *
 * Lit le référentiel des catégories d'acte DIRECTEMENT dans la migration
 * `prisma/sql/067_categories_acte.sql` : les tests unitaires utilisent ainsi
 * exactement la même liste que la base — aucune copie à maintenir. Ajouter une
 * catégorie à la migration la fait apparaître ici (et fait échouer le test
 * « chaque catégorie a un comportement défini » tant qu'il n'est pas complété).
 */
export function categoriesActeDeLaMigration(): CategorieActe[] {
  const sql = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'sql', '067_categories_acte.sql'),
    'utf8',
  );
  const bloc = sql.match(
    /insert into public\.categories_acte \(code, libelle, type_reclamation, role_revue, ordre\) values([\s\S]*?)on conflict/,
  );
  if (!bloc) throw new Error('INSERT de categories_acte introuvable dans la migration 067');
  const date = new Date('2026-10-07T00:00:00Z');
  return [...bloc[1].matchAll(/\('([A-Z_]+)',\s*'([^']+)',\s*'([A-Z_]+)',\s*'([A-Z_]+)',\s*(\d+)\)/g)].map(
    ([, code, libelle, typeReclamation, roleRevue, ordre]) => ({
      code,
      libelle,
      typeReclamation,
      roleRevue,
      actif: true,
      ordre: Number(ordre),
      createdAt: date,
      updatedAt: date,
    }),
  );
}

/** Vrai `CategoriesActeService` branché sur un Prisma factice servant la migration 067. */
export function categoriesActeServiceDeTest(
  categories: CategorieActe[] = categoriesActeDeLaMigration(),
): CategoriesActeService {
  const prisma = {
    categorieActe: { findMany: async () => [...categories].sort((a, b) => a.ordre - b.ordre) },
  } as unknown as PrismaService;
  return new CategoriesActeService(prisma);
}
