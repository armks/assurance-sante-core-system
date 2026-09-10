import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ContexteAppelant,
  ROLE_GESTION_MEMBRE_SOCIETE,
  ROLES_GESTION_MEMBRE,
} from './member.types';

type Db = PrismaService | Prisma.TransactionClient;

/** Contenu d'une carte à imprimer sur une page du PDF. */
interface InfosCarte {
  nomComplet: string;
  qualite: string;
  numeroCarte: string;
  formule: string;
  dateValidite: string;
  numeroReference: string;
  organisation: string;
}

/**
 * QR PNG encodant `contenu` (pour une carte : le `numero_carte`). Exporté pour
 * être testé isolément (round-trip de décodage). Correction d'erreur « M »,
 * marge minimale, 240 px — largement scannable une fois posé à ~96 pt.
 */
export async function qrEnPng(contenu: string): Promise<Buffer> {
  return QRCode.toBuffer(contenu, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
  });
}

/**
 * MemberCarteService — génération des cartes de membre (v9 phase 3, PROMPT 13).
 *
 * Choix d'architecture : **endpoint NestJS** dans `member/`, pas d'Edge Function.
 * Motif : la génération réutilise le contexte d'autorisation du module
 * (`ROLES_GESTION_MEMBRE` + `SOCIETE_ADMINISTRATION`), l'`IdentityService`, la
 * chaîne de rôles et `log_audit()` — tout cela vit déjà côté NestJS. Une Edge
 * Function dupliquerait le RBAC dans un runtime Deno séparé. Le stockage passe
 * par l'API Storage REST de Supabase avec la clé `service_role` (bucket privé
 * `cartes`, prisma/sql/023), et on renvoie une **URL signée** courte durée.
 */
@Injectable()
export class MemberCarteService {
  private readonly logger = new Logger(MemberCarteService.name);
  private readonly dureeUrlSignee = Number(
    process.env.CARTE_URL_TTL_SECONDS ?? 3600,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // --- Endpoints ---------------------------------------------------

  async genererCarteAdherent(user: AuthenticatedUser, adherentId: string) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherentComplet(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);

    const infos = this.infosDepuisAdherent(adherent);
    const qr = await qrEnPng(adherent.numeroCarte);
    const pdf = await this.construirePdf([{ infos, qr }]);

    const chemin = `${ctx.organisationId}/adherents/${adherentId}/carte-${Date.now()}.pdf`;
    const { url, expiresIn } = await this.televerserEtSigner(chemin, pdf);

    await this.audit(this.prisma, ctx.userId, 'GENERATION_CARTE_ADHERENT', adherentId, {
      numeroCarte: adherent.numeroCarte,
      chemin,
    });

    return {
      url,
      expiresIn,
      chemin,
      numeroCarte: adherent.numeroCarte,
      qrCode: `data:image/png;base64,${qr.toString('base64')}`,
    };
  }

  async genererCarteBeneficiaire(
    user: AuthenticatedUser,
    adherentId: string,
    beneficiaireId: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    const adherent = await this.chargerAdherentComplet(ctx, adherentId);
    this.assertGestion(ctx, adherent.souscripteurId);

    const benef = adherent.beneficiaires.find((b) => b.id === beneficiaireId);
    if (!benef) {
      throw new NotFoundException('Bénéficiaire introuvable.');
    }

    const infos = this.infosDepuisBeneficiaire(adherent, benef);
    const qr = await qrEnPng(benef.numeroCarte);
    const pdf = await this.construirePdf([{ infos, qr }]);

    const chemin = `${ctx.organisationId}/beneficiaires/${beneficiaireId}/carte-${Date.now()}.pdf`;
    const { url, expiresIn } = await this.televerserEtSigner(chemin, pdf);

    await this.audit(
      this.prisma,
      ctx.userId,
      'GENERATION_CARTE_BENEFICIAIRE',
      beneficiaireId,
      { numeroCarte: benef.numeroCarte, adherentId, chemin },
    );

    return {
      url,
      expiresIn,
      chemin,
      numeroCarte: benef.numeroCarte,
      qrCode: `data:image/png;base64,${qr.toString('base64')}`,
    };
  }

  async genererCartesSouscripteur(
    user: AuthenticatedUser,
    souscripteurId: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx, souscripteurId);

    const souscripteur = await this.prisma.souscripteur.findFirst({
      where: {
        id: souscripteurId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!souscripteur) {
      throw new NotFoundException(
        'Souscripteur inconnu ou hors de votre organisation.',
      );
    }

    const adherents = await this.prisma.adherent.findMany({
      where: {
        souscripteurId,
        organisationId: ctx.organisationId,
        statut: 'ACTIF',
        deletedAt: null,
      },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      include: {
        organisation: { select: { nom: true } },
        souscripteur: { select: { nom: true } },
        police: { include: { produit: true } },
      },
    });
    if (adherents.length === 0) {
      throw new NotFoundException(
        'Aucun adhérent actif pour ce souscripteur — rien à générer.',
      );
    }

    const cartes = [];
    for (const adherent of adherents) {
      cartes.push({
        infos: this.infosDepuisAdherent(adherent),
        qr: await qrEnPng(adherent.numeroCarte),
      });
    }
    const pdf = await this.construirePdf(cartes);

    const chemin = `${ctx.organisationId}/souscripteurs/${souscripteurId}/lot-${Date.now()}.pdf`;
    const { url, expiresIn } = await this.televerserEtSigner(chemin, pdf);

    await this.audit(
      this.prisma,
      ctx.userId,
      'GENERATION_CARTES_LOT',
      souscripteurId,
      { nombreCartes: adherents.length, chemin },
    );

    return { url, expiresIn, chemin, nombreCartes: adherents.length };
  }

  // --- Données de carte -------------------------------------------

  private infosDepuisAdherent(adherent: AdherentCarteBase): InfosCarte {
    return {
      nomComplet: `${adherent.prenom} ${adherent.nom}`.trim(),
      qualite: 'Titulaire',
      numeroCarte: adherent.numeroCarte,
      formule: this.libelleFormule(adherent.police),
      dateValidite: this.libelleValidite(adherent.police),
      numeroReference: adherent.numeroAdherent,
      organisation: adherent.organisation?.nom ?? 'Assurance santé',
    };
  }

  private infosDepuisBeneficiaire(
    adherent: AdherentComplet,
    benef: AdherentComplet['beneficiaires'][number],
  ): InfosCarte {
    return {
      nomComplet: `${benef.prenom} ${benef.nom}`.trim(),
      qualite: `Ayant droit (${benef.lienParente}) - titulaire : ${adherent.prenom} ${adherent.nom}`,
      numeroCarte: benef.numeroCarte,
      formule: this.libelleFormule(adherent.police),
      dateValidite: this.libelleValidite(adherent.police),
      numeroReference: adherent.numeroAdherent,
      organisation: adherent.organisation?.nom ?? 'Assurance santé',
    };
  }

  private libelleFormule(police: AdherentCarteBase['police']): string {
    if (!police?.produit) return 'Non rattaché à une police';
    return `${police.produit.nom} v${police.produit.version}`;
  }

  private libelleValidite(police: AdherentCarteBase['police']): string {
    if (!police?.dateFin) return 'Non définie';
    return new Date(police.dateFin).toLocaleDateString('fr-FR');
  }

  // --- PDF --------------------------------------------------------

  private async construirePdf(
    cartes: { infos: InfosCarte; qr: Buffer }[],
  ): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.setTitle('Carte(s) de membre');
    doc.setProducer('assurance-sante-core-system');
    const police = await doc.embedFont(StandardFonts.Helvetica);
    const policeGras = await doc.embedFont(StandardFonts.HelveticaBold);

    const L = 340;
    const H = 214;
    const encre = rgb(0.1, 0.1, 0.16);
    const gris = rgb(0.42, 0.42, 0.48);
    const bleu = rgb(0.13, 0.29, 0.53);

    for (const { infos, qr } of cartes) {
      const page = doc.addPage([L, H]);
      page.drawRectangle({ x: 0, y: 0, width: L, height: H, color: rgb(0.98, 0.98, 1) });
      page.drawRectangle({ x: 0, y: H - 36, width: L, height: 36, color: bleu });
      page.drawText(this.ascii(infos.organisation).toUpperCase(), {
        x: 14,
        y: H - 22,
        size: 10,
        font: policeGras,
        color: rgb(1, 1, 1),
      });
      page.drawText('CARTE DE MEMBRE', {
        x: 14,
        y: H - 32,
        size: 6,
        font: police,
        color: rgb(0.82, 0.88, 1),
      });

      let y = H - 58;
      page.drawText(this.ascii(infos.nomComplet), {
        x: 14,
        y,
        size: 15,
        font: policeGras,
        color: encre,
      });
      y -= 15;
      page.drawText(this.ascii(infos.qualite), {
        x: 14,
        y,
        size: 7,
        font: police,
        color: gris,
      });

      y -= 22;
      const ligne = (label: string, valeur: string) => {
        page.drawText(label, { x: 14, y, size: 6.5, font: police, color: gris });
        page.drawText(this.ascii(valeur), {
          x: 14,
          y: y - 11,
          size: 9,
          font: policeGras,
          color: encre,
        });
        y -= 27;
      };
      ligne('N° DE CARTE', infos.numeroCarte);
      ligne('FORMULE', infos.formule);
      ligne('VALABLE JUSQU AU', infos.dateValidite);

      const qrImg = await doc.embedPng(qr);
      const taille = 96;
      page.drawImage(qrImg, {
        x: L - taille - 14,
        y: 16,
        width: taille,
        height: taille,
      });
      page.drawText(infos.numeroReference, {
        x: L - taille - 14,
        y: 7,
        size: 6,
        font: police,
        color: gris,
      });
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  /** pdf-lib (Helvetica/WinAnsi) : on retire ce qui n'est pas encodable. */
  private ascii(texte: string): string {
    return texte
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(/[^ -ÿ]/g, '');
  }

  // --- Stockage --------------------------------------------------

  private get baseStorage(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1`;
  }

  private get serviceKey(): string {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  }

  private async televerserEtSigner(
    chemin: string,
    pdf: Buffer,
  ): Promise<{ url: string; expiresIn: number }> {
    if (!process.env.SUPABASE_URL || !this.serviceKey) {
      throw new ServiceUnavailableException(
        'Stockage des cartes indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.',
      );
    }

    const majTete = {
      Authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
    };

    const up = await fetch(`${this.baseStorage}/object/cartes/${chemin}`, {
      method: 'POST',
      headers: {
        ...majTete,
        'Content-Type': 'application/pdf',
        'x-upsert': 'true',
      },
      body: pdf as unknown as BodyInit,
    });
    if (!up.ok) {
      throw new ServiceUnavailableException(
        `Téléversement de la carte refusé (${up.status} : ${(await up.text()).slice(0, 200)}).`,
      );
    }

    const sign = await fetch(`${this.baseStorage}/object/sign/cartes/${chemin}`, {
      method: 'POST',
      headers: { ...majTete, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: this.dureeUrlSignee }),
    });
    if (!sign.ok) {
      throw new ServiceUnavailableException(
        `Signature de l'URL de carte refusée (${sign.status}).`,
      );
    }
    const corps = (await sign.json()) as { signedURL?: string; signedUrl?: string };
    const rel = corps.signedURL ?? corps.signedUrl;
    if (!rel) {
      throw new ServiceUnavailableException(
        "Réponse de signature inattendue (pas d'URL).",
      );
    }
    return {
      url: `${this.baseStorage}${rel.startsWith('/') ? '' : '/'}${rel}`,
      expiresIn: this.dureeUrlSignee,
    };
  }

  // --- Helpers communs (mêmes règles que AdherentService) --------

  private async contexteAppelant(
    user: AuthenticatedUser,
  ): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException(
        "Ce compte n'est rattaché à aucune organisation.",
      );
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      roleChain: permissions?.roleChain ?? [],
      societeId: profil.societeId ?? null,
    };
  }

  private aRoleAssureur(ctx: ContexteAppelant): boolean {
    return ctx.roleChain.some((code) =>
      (ROLES_GESTION_MEMBRE as readonly string[]).includes(code),
    );
  }

  private assertGestion(
    ctx: ContexteAppelant,
    souscripteurId: string | null,
  ): void {
    if (this.aRoleAssureur(ctx)) return;
    if (
      ctx.roleChain.includes(ROLE_GESTION_MEMBRE_SOCIETE) &&
      souscripteurId !== null &&
      ctx.societeId === souscripteurId
    ) {
      return;
    }
    throw new ForbiddenException(
      "La génération des cartes est réservée au personnel ASSUREUR habilité, ou à SOCIETE_ADMINISTRATION pour ses propres adhérents.",
    );
  }

  private async chargerAdherentComplet(
    ctx: ContexteAppelant,
    id: string,
  ): Promise<AdherentComplet> {
    const adherent = await this.prisma.adherent.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null },
      include: {
        organisation: { select: { nom: true } },
        souscripteur: { select: { nom: true } },
        police: { include: { produit: true } },
        beneficiaires: { where: { deletedAt: null } },
      },
    });
    if (!adherent) {
      throw new NotFoundException('Adhérent introuvable.');
    }
    if (
      !this.aRoleAssureur(ctx) &&
      ctx.roleChain.includes(ROLE_GESTION_MEMBRE_SOCIETE) &&
      adherent.souscripteurId !== ctx.societeId
    ) {
      throw new NotFoundException('Adhérent introuvable.');
    }
    return adherent as AdherentComplet;
  }

  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${'adherents'}::text,
          ${enregistrementId}::uuid,
          ${userId}::uuid,
          ${details === null ? null : JSON.stringify(details)}::jsonb
        )`;
    } catch (error) {
      this.logger.error(
        `Échec log_audit(${action}, ${enregistrementId}) : ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
      throw error;
    }
  }
}

type AdherentComplet = Prisma.AdherentGetPayload<{
  include: {
    organisation: { select: { nom: true } };
    souscripteur: { select: { nom: true } };
    police: { include: { produit: true } };
    beneficiaires: true;
  };
}>;

/** Sous-ensemble suffisant pour composer une carte (adhérent seul ou en lot). */
type AdherentCarteBase = Pick<
  AdherentComplet,
  'nom' | 'prenom' | 'numeroCarte' | 'numeroAdherent' | 'organisation' | 'police'
>;
