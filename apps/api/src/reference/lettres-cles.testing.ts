import type { PrismaService } from '../prisma/prisma.service';
import { categoriesActeServiceDeTest } from './categories-acte.testing';
import { LettresClesService } from './lettres-cles.service';

/** Codes d'amorçage de la migration 080 (aucune valeur chiffrée : ce sont de simples codes). */
export const CODES_LETTRES_CLES = ['B', 'Z', 'K', 'D', 'KA', 'KC', 'KE', 'P', 'AMI', 'AMK'];

/**
 * AIDE DE TEST UNIQUEMENT : vrai `LettresClesService` sur un Prisma factice servant les lettres-clés
 * d'amorçage (toutes actives, sauf `inactives`), avec le vrai référentiel des catégories (migration 067).
 */
export function lettresClesServiceDeTest(inactives: string[] = []): LettresClesService {
  const lignes = CODES_LETTRES_CLES.map((code, i) => ({
    code,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    libelle: `Lettre-clé ${code}`,
    actif: !inactives.includes(code),
    ordre: (i + 1) * 10,
    createdAt: new Date('2026-10-09T00:00:00Z'),
    updatedAt: new Date('2026-10-09T00:00:00Z'),
  }));
  const prisma = {
    lettreCle: {
      findMany: jest.fn(async (args?: { where?: { actif?: boolean } }) =>
        lignes.filter((l) => args?.where?.actif === undefined || l.actif === args.where.actif),
      ),
    },
  } as unknown as PrismaService;
  return new LettresClesService(prisma, categoriesActeServiceDeTest());
}
