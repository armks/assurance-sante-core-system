import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import * as QRCode from 'qrcode';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ContexteAppelant,
  ENTITE_ADHERENT,
  ENTITE_SOCIETE_AFFILIEE,
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
 * Format d'une photo d'après ses octets (jamais d'après l'extension du chemin).
 * pdf-lib n'embarque que PNG et JPEG : tout le reste (WEBP, fichier corrompu…)
 * renvoie `null` et la carte est générée avec la silhouette neutre.
 */
export function formatPhotoPdf(octets: Buffer): 'png' | 'jpg' | null {
  if (octets.length >= 8 && octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) {
    return 'jpg';
  }
  return null;
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
    // Self-service : un adhérent peut générer SA PROPRE carte (chargerAdherentComplet
    // a déjà renvoyé 404 si `adherentId` n'était pas le sien — voir ce garde-fou).
    const estPropreCarte =
      ctx.entite === ENTITE_ADHERENT && ctx.adherentId === adherentId;
    this.assertGestion(ctx, adherent.souscripteurId, estPropreCarte);
    if (adherent.statut !== 'ACTIF') {
      throw new ConflictException(
        `Carte indisponible : l'adhérent est « ${adherent.statut} ». Seul un adhérent ACTIF a une carte valide.`,
      );
    }

    const infos = this.infosDepuisAdherent(adherent);
    const qr = await qrEnPng(adherent.numeroCarte);
    const photo = await this.chargerPhoto(adherent.photoUrl);
    const pdf = await this.construirePdf([{ infos, qr, photo }]);

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
    if (benef.statut !== 'ACTIF' || adherent.statut !== 'ACTIF') {
      throw new ConflictException(
        benef.statut !== 'ACTIF'
          ? `Carte indisponible : le bénéficiaire est « ${benef.statut} ».`
          : `Carte indisponible : l'adhérent titulaire est « ${adherent.statut} ».`,
      );
    }
    if (!benef.numeroCarte) {
      // Ne devrait jamais arriver (contrainte `beneficiaires_carte_coherente`,
      // prisma/sql/055 : ACTIF implique numero_carte non nul) — garde explicite
      // plutôt qu'une assertion `!`, cohérent avec le style du module.
      throw new ConflictException(
        "Ce bénéficiaire n'a pas encore de numéro de carte (double validation en cours).",
      );
    }

    const numeroCarte = benef.numeroCarte;
    const infos = this.infosDepuisBeneficiaire(adherent, { ...benef, numeroCarte });
    const qr = await qrEnPng(numeroCarte);
    const photo = await this.chargerPhoto(benef.photoUrl);
    const pdf = await this.construirePdf([{ infos, qr, photo }]);

    const chemin = `${ctx.organisationId}/beneficiaires/${beneficiaireId}/carte-${Date.now()}.pdf`;
    const { url, expiresIn } = await this.televerserEtSigner(chemin, pdf);

    await this.audit(
      this.prisma,
      ctx.userId,
      'GENERATION_CARTE_BENEFICIAIRE',
      beneficiaireId,
      { numeroCarte, adherentId, chemin },
    );

    return {
      url,
      expiresIn,
      chemin,
      numeroCarte,
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
        photo: await this.chargerPhoto(adherent.photoUrl),
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
    // `numeroCarte` déjà vérifié non nul par l'appelant (statut ACTIF implique
    // numero_carte non nul, contrainte `beneficiaires_carte_coherente`).
    benef: Omit<AdherentComplet['beneficiaires'][number], 'numeroCarte'> & { numeroCarte: string },
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
    cartes: { infos: InfosCarte; qr: Buffer; photo: Buffer | null }[],
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

    // Médaillon photo : en haut à droite, entre le bandeau (H - 36) et le QR
    // (sommet à 16 + 96 = 112). Le texte de gauche est borné pour ne jamais
    // passer dessous, même avec un nom très long.
    const rayon = 26;
    const cx = L - 14 - rayon;
    const cy = H - 36 - 8 - rayon;
    const largeurTexte = cx - rayon - 10 - 14;
    const largeurValeurs = L - 96 - 14 - 10 - 14;

    for (const { infos, qr, photo } of cartes) {
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

      await this.dessinerMedaillon(doc, page, photo, cx, cy, rayon);

      let y = H - 58;
      const nom = this.ajuster(this.ascii(infos.nomComplet), policeGras, 15, 10, largeurTexte);
      page.drawText(nom.texte, {
        x: 14,
        y,
        size: nom.taille,
        font: policeGras,
        color: encre,
      });
      y -= 15;
      const qualite = this.ajuster(this.ascii(infos.qualite), police, 7, 6, largeurTexte);
      page.drawText(qualite.texte, {
        x: 14,
        y,
        size: qualite.taille,
        font: police,
        color: gris,
      });

      y -= 22;
      const ligne = (label: string, valeur: string) => {
        page.drawText(label, { x: 14, y, size: 6.5, font: police, color: gris });
        const v = this.ajuster(this.ascii(valeur), policeGras, 9, 7, largeurValeurs);
        page.drawText(v.texte, {
          x: 14,
          y: y - 11,
          size: v.taille,
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

  /**
   * Médaillon rond : la photo (recadrée « cover » dans un cercle) si elle est
   * embarquable, sinon une silhouette neutre — jamais d'erreur, jamais d'image
   * cassée. Un échec d'embarquement (octets PNG/JPEG corrompus) retombe aussi
   * sur la silhouette.
   */
  private async dessinerMedaillon(
    doc: PDFDocument,
    page: PDFPage,
    photo: Buffer | null,
    cx: number,
    cy: number,
    r: number,
  ): Promise<void> {
    let image: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
    const format = photo ? formatPhotoPdf(photo) : null;
    if (photo && format) {
      try {
        image = format === 'png' ? await doc.embedPng(photo) : await doc.embedJpg(photo);
      } catch (error) {
        this.logger.warn(
          `Photo non embarquable dans la carte (${error instanceof Error ? error.message : 'erreur inconnue'}) — silhouette neutre.`,
        );
      }
    } else if (photo) {
      this.logger.warn('Photo dans un format non supporté par le PDF (PNG/JPEG uniquement) — silhouette neutre.');
    }

    // Cercle de découpe : 4 courbes de Bézier (k ≈ 0,5523).
    const k = 0.5523 * r;
    page.pushOperators(
      pushGraphicsState(),
      moveTo(cx + r, cy),
      appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
      appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
      appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
      appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
      closePath(),
      clip(),
      endPath(),
    );
    if (image) {
      const echelle = (2 * r) / Math.min(image.width, image.height);
      const w = image.width * echelle;
      const h = image.height * echelle;
      page.drawImage(image, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
    } else {
      page.drawCircle({ x: cx, y: cy, size: r, color: rgb(0.9, 0.91, 0.94) });
      page.drawCircle({ x: cx, y: cy + r * 0.22, size: r * 0.3, color: rgb(0.7, 0.72, 0.78) });
      page.drawEllipse({ x: cx, y: cy - r * 0.78, xScale: r * 0.62, yScale: r * 0.5, color: rgb(0.7, 0.72, 0.78) });
    }
    page.pushOperators(popGraphicsState());
    page.drawCircle({ x: cx, y: cy, size: r, borderColor: rgb(0.13, 0.29, 0.53), borderWidth: 1.2 });
  }

  /** Réduit la taille de police jusqu'à `min`, puis tronque avec « ... » pour
   * tenir dans `largeur` — le texte ne déborde jamais sur le médaillon/QR. */
  private ajuster(
    texte: string,
    font: PDFFont,
    taille: number,
    min: number,
    largeur: number,
  ): { texte: string; taille: number } {
    let t = taille;
    while (t > min && font.widthOfTextAtSize(texte, t) > largeur) t -= 0.5;
    if (font.widthOfTextAtSize(texte, t) <= largeur) return { texte, taille: t };
    let court = texte;
    while (court.length > 1 && font.widthOfTextAtSize(`${court}...`, t) > largeur) {
      court = court.slice(0, -1);
    }
    return { texte: `${court.trimEnd()}...`, taille: t };
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

  /**
   * Octets de la photo (bucket privé `photos`, lecture `service_role`) —
   * `null` si aucune photo ou si le téléchargement échoue : la carte est alors
   * générée normalement avec la silhouette, jamais bloquée par la photo.
   */
  private async chargerPhoto(chemin: string | null | undefined): Promise<Buffer | null> {
    if (!chemin || !process.env.SUPABASE_URL || !this.serviceKey) return null;
    try {
      const res = await fetch(`${this.baseStorage}/object/authenticated/photos/${chemin}`, {
        headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey },
      });
      if (!res.ok) {
        this.logger.warn(`Photo introuvable pour la carte (${res.status}) : ${chemin} — silhouette neutre.`);
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      this.logger.warn(
        `Téléchargement de la photo impossible (${error instanceof Error ? error.message : 'erreur inconnue'}) — silhouette neutre.`,
      );
      return null;
    }
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
      entite: profil.entite ?? null,
      adherentId: profil.adherentId ?? null,
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
    estPropreCarte = false,
  ): void {
    if (estPropreCarte) return;
    if (this.aRoleAssureur(ctx)) return;
    if (
      ctx.roleChain.includes(ROLE_GESTION_MEMBRE_SOCIETE) &&
      souscripteurId !== null &&
      ctx.societeId === souscripteurId
    ) {
      return;
    }
    throw new ForbiddenException(
      "La génération des cartes est réservée au personnel ASSUREUR habilité, à SOCIETE_ADMINISTRATION pour ses propres adhérents, ou à l'adhérent pour sa propre carte.",
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
      ctx.entite === ENTITE_SOCIETE_AFFILIEE &&
      adherent.souscripteurId !== ctx.societeId
    ) {
      throw new NotFoundException('Adhérent introuvable.');
    }
    // Fuite inter-adhérent corrigée (audit dashboard adhérent) : un compte
    // ADHERENT ne peut charger que SON PROPRE enregistrement — jamais celui
    // d'un autre adhérent, même par ID direct (ex. sur /adherents/:id/carte).
    if (ctx.entite === ENTITE_ADHERENT && adherent.id !== ctx.adherentId) {
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
