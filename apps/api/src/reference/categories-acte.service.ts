import { BadRequestException, Injectable } from '@nestjs/common';
import type { CategorieActe } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Forme d'un code de `categories_acte` (même CHECK qu'en base, prisma/sql/067) ;
 * l'existence et le statut actif sont vérifiés par `exigerActive`. */
export const FORMAT_CODE_CATEGORIE = /^[A-Z][A-Z_]{1,39}$/;

/** Durée de vie du cache mémoire : le référentiel ne change que par migration. */
const TTL_MS = 60_000;

/**
 * Référentiel UNIQUE des catégories d'acte (`categories_acte`, prisma/sql/067) —
 * seule source pour : la validation des garanties et des actes, le type de
 * réclamation, le rôle de revue manuelle et les libellés du web (exposés par
 * `GET /reference/categories-acte`). Remplace `CATEGORIES_ACTE`,
 * `CATEGORIE_VERS_TYPE` et la liste du formulaire produit.
 */
@Injectable()
export class CategoriesActeService {
  private cache: { valeurs: CategorieActe[]; expire: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Toutes les catégories (actives ou non), dans l'ordre d'affichage. */
  async lister(): Promise<CategorieActe[]> {
    if (this.cache && this.cache.expire > Date.now()) {
      return this.cache.valeurs;
    }
    const valeurs = await this.prisma.categorieActe.findMany({
      orderBy: [{ ordre: 'asc' }, { code: 'asc' }],
    });
    this.cache = { valeurs, expire: Date.now() + TTL_MS };
    return valeurs;
  }

  async actives(): Promise<CategorieActe[]> {
    return (await this.lister()).filter((c) => c.actif);
  }

  async parCode(code: string): Promise<CategorieActe | undefined> {
    return (await this.lister()).find((c) => c.code === code);
  }

  /** Catégorie existante ET active, sinon 400 (garantie, acte de dossier). */
  async exigerActive(code: string): Promise<CategorieActe> {
    const categorie = await this.parCode(code);
    if (!categorie || !categorie.actif) {
      const codes = (await this.actives()).map((c) => c.code).join(', ');
      throw new BadRequestException(
        `Catégorie d'acte inconnue ou inactive : « ${code} ». Valeurs acceptées : ${codes}.`,
      );
    }
    return categorie;
  }

  /**
   * Catégorie d'un référentiel d'actes (organisation ou catalogue national),
   * autrefois en texte libre : accepte le code (« CONSULTATION ») ou le
   * libellé (« Consultation », casse et accents ignorés) et renvoie le code.
   * Vide → null. Inconnue → 400.
   */
  async normaliser(valeur: string | null | undefined): Promise<string | null> {
    const v = valeur?.trim();
    if (!v) return null;
    const cle = cleComparaison(v);
    const categorie = (await this.actives()).find(
      (c) => cleComparaison(c.code) === cle || cleComparaison(c.libelle) === cle,
    );
    if (!categorie) {
      const codes = (await this.actives()).map((c) => c.code).join(', ');
      throw new BadRequestException(
        `Catégorie d'acte inconnue : « ${v} ». Valeurs acceptées : ${codes}.`,
      );
    }
    return categorie.code;
  }
}

/** « Analyses de laboratoire » et « ANALYSES_DE_LABORATOIRE » → même clé. */
function cleComparaison(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
