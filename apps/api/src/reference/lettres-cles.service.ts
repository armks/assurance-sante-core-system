import { BadRequestException, Injectable } from '@nestjs/common';
import type { LettreCle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from './categories-acte.service';

export const MODES_COTATION = ['ISOLE', 'GROUPE'] as const;
export type ModeCotation = (typeof MODES_COTATION)[number];

/** Coefficient maximal accepté (garde-fou de saisie, numeric(8,2)). */
export const COEFFICIENT_MAX = 99999.99;
export const FORMAT_CODE_LETTRE_CLE = /^[A-Z]{1,4}$/;
const FORMAT_CODE_GROUPE = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;

/** Cotation telle que saisie (API ou ligne d'import) : tout est facultatif et non vérifié. */
export interface CotationBrute {
  lettreCleCode?: string | null;
  coefficient?: number | string | null;
  modeCotation?: string | null;
  categorieGarantie?: string | null;
  groupeCode?: string | null;
}

/** Cotation vérifiée, prête à être enregistrée (coefficient en chaîne à 2 décimales). */
export interface CotationValide {
  lettreCleCode: string | null;
  coefficient: string | null;
  modeCotation: ModeCotation;
  categorieGarantie: string | null;
  groupeCode: string | null;
}

const vide = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
const sansAccent = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/**
 * Lettres-clés de la nomenclature (`lettres_cles`, prisma/sql/080) et validation de la cotation d'un acte
 * (lettre-clé + coefficient + mode + catégorie de garantie + groupe). AUCUNE valeur en FCFA : les valeurs
 * se négocient par établissement dans les conventions (lots suivants).
 */
@Injectable()
export class LettresClesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesActe: CategoriesActeService,
  ) {}

  async lister(): Promise<LettreCle[]> {
    return this.prisma.lettreCle.findMany({ orderBy: [{ ordre: 'asc' }, { code: 'asc' }] });
  }

  private async codesActifs(): Promise<Set<string>> {
    const l = await this.prisma.lettreCle.findMany({ where: { actif: true }, select: { code: true } });
    return new Set(l.map((x) => x.code));
  }

  /**
   * Toutes les erreurs de la cotation (liste vide = valide), avec la cotation normalisée si elle l'est.
   * Sert à la validation ligne par ligne de l'import (rapport d'erreurs) comme à l'API.
   */
  async analyser(
    brute: CotationBrute,
    codesActifs?: Set<string>,
  ): Promise<{ erreurs: string[]; valide: CotationValide }> {
    const erreurs: string[] = [];
    const actifs = codesActifs ?? (await this.codesActifs());

    const lettre = vide(brute.lettreCleCode) ? null : String(brute.lettreCleCode).trim().toUpperCase();
    if (lettre && !actifs.has(lettre)) {
      erreurs.push(`lettre-clé inconnue ou inactive (${lettre})`);
    }

    let coefficient: string | null = null;
    if (!vide(brute.coefficient)) {
      const texte = String(brute.coefficient).trim().replace(',', '.');
      const n = Number(texte);
      if (!/^\d+(\.\d{1,2})?$/.test(texte) || !Number.isFinite(n)) {
        erreurs.push(`coefficient invalide (${brute.coefficient}) : nombre positif à 2 décimales au plus`);
      } else if (n <= 0) {
        erreurs.push(`coefficient invalide (${brute.coefficient}) : doit être strictement positif`);
      } else if (n > COEFFICIENT_MAX) {
        erreurs.push(`coefficient trop grand (${brute.coefficient}) : ${COEFFICIENT_MAX} au maximum`);
      } else {
        coefficient = n.toFixed(2);
      }
    }
    if (lettre && vide(brute.coefficient)) erreurs.push('coefficient manquant (obligatoire avec une lettre-clé)');
    if (!lettre && !vide(brute.coefficient)) erreurs.push('lettre-clé manquante (obligatoire avec un coefficient)');

    let mode: ModeCotation = 'ISOLE';
    if (!vide(brute.modeCotation)) {
      const m = sansAccent(String(brute.modeCotation));
      if (m === 'ISOLE') mode = 'ISOLE';
      else if (m === 'GROUPE') mode = 'GROUPE';
      else erreurs.push(`mode de cotation inconnu (${brute.modeCotation}) : ISOLE ou GROUPE`);
    }

    let groupe: string | null = null;
    if (!vide(brute.groupeCode)) {
      groupe = String(brute.groupeCode).trim().toUpperCase();
      if (!FORMAT_CODE_GROUPE.test(groupe)) {
        erreurs.push(`code de groupe invalide (${brute.groupeCode}) : lettres, chiffres, tiret ou souligné, 40 caractères au plus`);
        groupe = null;
      }
    }
    if (mode === 'GROUPE' && !groupe && vide(brute.groupeCode)) erreurs.push('code de groupe manquant (obligatoire pour un acte groupé)');
    if (mode === 'ISOLE' && groupe) erreurs.push('code de groupe interdit pour un acte isolé');

    let categorieGarantie: string | null = null;
    if (!vide(brute.categorieGarantie)) {
      try {
        categorieGarantie = await this.categoriesActe.normaliser(String(brute.categorieGarantie));
      } catch {
        erreurs.push(`catégorie de garantie inconnue (${brute.categorieGarantie})`);
      }
    }

    return {
      erreurs,
      valide: {
        lettreCleCode: lettre && actifs.has(lettre) ? lettre : null,
        coefficient,
        modeCotation: mode,
        categorieGarantie,
        groupeCode: mode === 'GROUPE' ? groupe : null,
      },
    };
  }

  /** Cotation vérifiée ou 400 listant TOUTES les erreurs. */
  async valider(brute: CotationBrute): Promise<CotationValide> {
    const { erreurs, valide } = await this.analyser(brute);
    if (erreurs.length > 0) {
      throw new BadRequestException(`Cotation invalide : ${erreurs.join(' ; ')}.`);
    }
    return valide;
  }
}
