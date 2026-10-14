import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreerMaladieCim10Dto, ModifierMaladieCim10Dto } from './dto/cim10.dto';

const ROLE_SUPERADMIN = 'SUPERADMIN_PRINCIPAL';
/** Catégorie (A00) ou sous-catégorie (A00.0, B50.9, S06.00…) de la CIM-10. */
export const FORMAT_CODE_CIM10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;
const MAX_LIGNES_IMPORT = 30000;
const LIMITE_RECHERCHE = 50;
const PAR_PAGE_ADMIN = 25;

export interface FichierCim10 {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/**
 * Référentiel CIM-10 (prisma/sql/095) : table GLOBALE alimentée par le SUPERADMIN_PRINCIPAL (écran + import CSV),
 * consultée par les médecins qui choisissent un diagnostic — seul le code est conservé dans la consultation.
 */
@Injectable()
export class Cim10Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Lecture (tout compte authentifié) -------------------------

  /** Recherche par code (début) ou libellé (contient), maladies ACTIVES seulement — pour le sélecteur du médecin. */
  async rechercher(q?: string, limite?: number) {
    const terme = (q ?? '').trim();
    const take = Math.min(Math.max(Number(limite) || 20, 1), LIMITE_RECHERCHE);
    return this.prisma.maladieCim10.findMany({
      where: { actif: true, ...this.filtreTexte(terme) },
      select: { code: true, libelle: true },
      orderBy: { code: 'asc' },
      take,
    });
  }

  /** Vérifie qu'un code saisi existe et est actif ; renvoie le code normalisé (majuscules). */
  async verifierCode(code: string): Promise<string> {
    const normalise = code.trim().toUpperCase();
    const m = await this.prisma.maladieCim10.findUnique({ where: { code: normalise } });
    if (!m || !m.actif) {
      throw new BadRequestException(`Le code CIM-10 « ${normalise} » n'existe pas dans le référentiel (ou n'est plus actif).`);
    }
    return normalise;
  }

  // --- Administration (SUPERADMIN_PRINCIPAL) ---------------------

  async listerAdmin(user: AuthenticatedUser, q?: string, page?: number, statut?: string) {
    await this.assertSuperadmin(user);
    const where: Prisma.MaladieCim10WhereInput = {
      ...this.filtreTexte((q ?? '').trim()),
      ...(statut === 'ACTIF' ? { actif: true } : statut === 'INACTIF' ? { actif: false } : {}),
    };
    const p = Math.max(Number(page) || 1, 1);
    const [items, total, actives] = await Promise.all([
      this.prisma.maladieCim10.findMany({ where, orderBy: { code: 'asc' }, skip: (p - 1) * PAR_PAGE_ADMIN, take: PAR_PAGE_ADMIN }),
      this.prisma.maladieCim10.count({ where }),
      this.prisma.maladieCim10.count({ where: { actif: true } }),
    ]);
    return { items, total, page: p, limite: PAR_PAGE_ADMIN, pages: Math.max(Math.ceil(total / PAR_PAGE_ADMIN), 1), nbActives: actives };
  }

  async creer(user: AuthenticatedUser, dto: CreerMaladieCim10Dto) {
    const { userId } = await this.assertSuperadmin(user);
    const code = dto.code.trim().toUpperCase();
    if (!FORMAT_CODE_CIM10.test(code)) {
      throw new BadRequestException('Le code CIM-10 comporte une lettre, deux chiffres puis, au besoin, un point et 1 à 4 caractères (ex. B50, B50.9).');
    }
    const libelle = this.libelleValide(dto.libelle);
    if (await this.prisma.maladieCim10.findUnique({ where: { code } })) {
      throw new ConflictException(`Le code « ${code} » existe déjà.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.maladieCim10.create({ data: { code, libelle } });
      await this.audit(tx, userId, 'CREATION_MALADIE_CIM10', m.id, { code, libelle });
      return m;
    });
  }

  async modifier(user: AuthenticatedUser, id: string, dto: ModifierMaladieCim10Dto) {
    const { userId } = await this.assertSuperadmin(user);
    const avant = await this.trouver(id);
    const libelle = this.libelleValide(dto.libelle);
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.maladieCim10.update({ where: { id }, data: { libelle } });
      await this.audit(tx, userId, 'MODIFICATION_MALADIE_CIM10', id, { code: avant.code, avant: avant.libelle, apres: libelle });
      return m;
    });
  }

  async changerStatut(user: AuthenticatedUser, id: string, actif: boolean) {
    const { userId } = await this.assertSuperadmin(user);
    const m = await this.trouver(id);
    return this.prisma.$transaction(async (tx) => {
      const maj = await tx.maladieCim10.update({ where: { id }, data: { actif } });
      await this.audit(tx, userId, actif ? 'REACTIVATION_MALADIE_CIM10' : 'DESACTIVATION_MALADIE_CIM10', id, { code: m.code });
      return maj;
    });
  }

  /** Les consultations ne conservent que le code (texte, sans clé étrangère) : supprimer n'altère aucun dossier. */
  async supprimer(user: AuthenticatedUser, id: string) {
    const { userId } = await this.assertSuperadmin(user);
    const m = await this.trouver(id);
    await this.prisma.$transaction(async (tx) => {
      await this.audit(tx, userId, 'SUPPRESSION_MALADIE_CIM10', id, { code: m.code, libelle: m.libelle });
      await tx.maladieCim10.delete({ where: { id } });
    });
    return { code: m.code, supprimee: true };
  }

  /**
   * Import CSV / texte (UTF-8) : une ligne par maladie « code;libellé » (séparateur point-virgule, virgule ou tabulation,
   * en-tête facultatif). Un code déjà connu voit son libellé mis à jour ; les lignes invalides sont listées, jamais ignorées en silence.
   */
  async importer(user: AuthenticatedUser, fichier: FichierCim10 | undefined) {
    const { userId } = await this.assertSuperadmin(user);
    if (!fichier?.buffer?.length) throw new BadRequestException('Fichier manquant ou vide.');
    const texte = fichier.buffer.toString('utf8').replace(/^﻿/, '');
    const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
    if (lignes.length > MAX_LIGNES_IMPORT) {
      throw new BadRequestException(`Le fichier dépasse ${MAX_LIGNES_IMPORT} lignes.`);
    }
    const retenus = new Map<string, string>();
    const erreurs: { ligne: number; contenu: string; raison: string }[] = [];
    lignes.forEach((brut, i) => {
      const m = /^\s*([^;,\t]+?)\s*[;,\t]\s*(.+?)\s*$/.exec(brut);
      const code = m?.[1].replace(/^"|"$/g, '').toUpperCase();
      const libelle = m?.[2].replace(/^"|"$/g, '').replace(/\s+/g, ' ').trim();
      if (i === 0 && code === 'CODE') return; // en-tête
      if (!code || !libelle) return void erreurs.push({ ligne: i + 1, contenu: brut.slice(0, 120), raison: 'Format attendu : code;libellé.' });
      if (!FORMAT_CODE_CIM10.test(code)) return void erreurs.push({ ligne: i + 1, contenu: brut.slice(0, 120), raison: `Code CIM-10 « ${code} » invalide.` });
      if (libelle.length < 2 || libelle.length > 300) return void erreurs.push({ ligne: i + 1, contenu: brut.slice(0, 120), raison: 'Libellé de 2 à 300 caractères exigé.' });
      retenus.set(code, libelle);
    });
    if (retenus.size === 0) {
      throw new BadRequestException({ message: 'Aucune ligne valide à importer.', erreurs: erreurs.slice(0, 20) });
    }
    const entrees = [...retenus.entries()];
    let crees = 0;
    let modifies = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < entrees.length; i += 2000) {
          const lot = entrees.slice(i, i + 2000);
          const res = await tx.$queryRaw<{ cree: boolean }[]>`
            INSERT INTO public.maladies_cim10 (code, libelle)
            SELECT * FROM unnest(${lot.map(([c]) => c)}::text[], ${lot.map(([, l]) => l)}::text[])
            ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle, updated_at = now()
              WHERE maladies_cim10.libelle IS DISTINCT FROM EXCLUDED.libelle
            RETURNING (xmax = 0) AS cree`;
          for (const r of res) {
            if (r.cree) crees++;
            else modifies++;
          }
        }
        await this.audit(tx, userId, 'IMPORT_MALADIES_CIM10', userId, {
          fichier: fichier.originalname,
          lignes: lignes.length,
          crees,
          modifies,
          erreurs: erreurs.length,
        });
      },
      { timeout: 120000, maxWait: 10000 },
    );
    return {
      lignesLues: lignes.length,
      crees,
      modifies,
      inchanges: retenus.size - crees - modifies,
      nbErreurs: erreurs.length,
      erreurs: erreurs.slice(0, 50),
    };
  }

  // --- Interne ----------------------------------------------------

  private filtreTexte(terme: string): Prisma.MaladieCim10WhereInput {
    if (!terme) return {};
    return {
      OR: [
        { code: { startsWith: terme.toUpperCase() } },
        { libelle: { contains: terme, mode: 'insensitive' } },
      ],
    };
  }

  private libelleValide(libelle: string): string {
    const l = libelle.trim().replace(/\s+/g, ' ');
    if (l.length < 2 || l.length > 300) throw new BadRequestException('Le libellé compte 2 à 300 caractères.');
    return l;
  }

  private async trouver(id: string) {
    const m = await this.prisma.maladieCim10.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Maladie introuvable.');
    return m;
  }

  private async assertSuperadmin(user: AuthenticatedUser): Promise<{ userId: string }> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!(permissions?.roleChain ?? []).includes(ROLE_SUPERADMIN)) {
      throw new ForbiddenException('Action réservée au superadministrateur (SUPERADMIN_PRINCIPAL).');
    }
    return { userId: profil.id };
  }

  private async audit(
    db: Prisma.TransactionClient,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.$executeRaw`
      SELECT log_audit(${action}::text, 'maladies_cim10'::text, ${enregistrementId}::uuid, ${userId}::uuid, ${JSON.stringify(details)}::jsonb)`;
  }
}
