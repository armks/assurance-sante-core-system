'use client';

import { createContext, useContext, useMemo } from 'react';

import { libelleCodeLisible } from '@/lib/referentiel';

/** Ligne du référentiel unique `categories_acte` (API `GET /reference/categories-acte`). */
export interface CategorieActe {
  code: string;
  libelle: string;
  typeReclamation: string;
  roleRevue: string;
  actif: boolean;
  ordre: number;
}

const ContexteCategoriesActe = createContext<CategorieActe[]>([]);

/**
 * Fournit le référentiel des catégories d'acte, chargé UNE fois par le layout
 * serveur du dashboard (`chargerCategoriesActe`) — seule source des libellés et
 * des listes de catégories côté web (prisma/sql/067).
 */
export function CategoriesActeProvider({
  categories,
  children,
}: {
  categories: CategorieActe[];
  children: React.ReactNode;
}) {
  return (
    <ContexteCategoriesActe.Provider value={categories}>
      {children}
    </ContexteCategoriesActe.Provider>
  );
}

/**
 * `libelle(code)` : libellé du référentiel ; repli lisible si le code est
 * inconnu (« SOINS_PALLIATIFS » → « Soins palliatifs »), jamais le code brut.
 * `options()` : catégories ACTIVES pour un `<select>`, dans l'ordre du référentiel.
 */
export function useCategoriesActe() {
  const categories = useContext(ContexteCategoriesActe);
  return useMemo(() => {
    const parCode = new Map(categories.map((c) => [c.code, c]));
    const libelle = (code: string | null | undefined): string => {
      const v = code?.trim();
      if (!v) return '—';
      return parCode.get(v.toUpperCase())?.libelle ?? libelleCodeLisible(v);
    };
    const options = () =>
      categories
        .filter((c) => c.actif)
        .map((c) => ({ valeur: c.code, libelle: c.libelle }));
    return { categories, libelle, options };
  }, [categories]);
}
