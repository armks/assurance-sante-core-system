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
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import * as QRCode from 'qrcode';
import sharp from 'sharp';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { formatImagePdf } from '../common/images.util';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ContexteAppelant,
  ENTITE_ADHERENT,
  ENTITE_SOCIETE_AFFILIEE,
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
  /** « Tél. … · e-mail » de la société d'assurance (bandeau), null si aucun des deux. */
  contact: string | null;
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
    const [photo, logo] = await Promise.all([
      this.chargerPhoto(adherent.photoUrl),
      this.chargerLogo(adherent.organisation?.logoUrl),
    ]);
    const pdf = await this.construirePdf([{ infos, qr, photo }], logo);

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
    const [photo, logo] = await Promise.all([
      this.chargerPhoto(benef.photoUrl),
      this.chargerLogo(adherent.organisation?.logoUrl),
    ]);
    const pdf = await this.construirePdf([{ infos, qr, photo }], logo);

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
        organisation: { select: { nom: true, logoUrl: true, telephoneContact: true, emailContact: true } },
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
    const logo = await this.chargerLogo(adherents[0]?.organisation?.logoUrl);
    const pdf = await this.construirePdf(cartes, logo);

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
      contact: this.contactSociete(adherent.organisation),
    };
  }

  /** Coordonnées de la société (celles de sa page /{slug}) : tél. puis e-mail. */
  private contactSociete(
    organisation: { telephoneContact: string | null; emailContact: string | null } | null,
  ): string | null {
    const tel = organisation?.telephoneContact?.trim();
    const email = organisation?.emailContact?.trim();
    const parties = [tel ? `Tél. ${tel}` : null, email || null].filter(Boolean);
    return parties.length > 0 ? parties.join('  ·  ') : null;
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
      contact: this.contactSociete(adherent.organisation),
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

  /**
   * Carte au format ID-1 (340 × 214 pt, ratio 85,6 × 54 mm). Origine en bas à
   * gauche. Zones (aucun chevauchement ; tout contenu dans la zone de sécurité
   * d'impression de 3 mm = 8,5 pt, seuls les fonds vont jusqu'au bord) :
   *   - filigrane : logo de l'organisation (si `logo_url`) en grand, sur toute
   *     la zone claire à GAUCHE de la photo (x 8,5–214 : de la marge de sécurité
   *     jusqu'au bord de la photo, jamais dessous), opacité 10 %, dessiné AVANT
   *     tout le reste (texte et QR restent lisibles par-dessus) ;
   *   - bandeau 40 pt : logo (pastille blanche, 22 pt de haut) puis nom de la
   *     compagnie, et sous lui « CARTE DE MEMBRE » suivi, sur la même ligne, du
   *     téléphone et de l'e-mail de contact de la société (s'ils sont
   *     renseignés). Opaque et dessiné APRÈS le filigrane : un logo sur fond
   *     blanc (JPEG) laisserait sinon un rectangle pâle visible sur le bleu ;
   *   - photo CARRÉE 112 × 112 pt, sans contour, bord droit à la marge et
   *     centrée verticalement dans le corps (x 214–326, y 31–143) ;
   *   - QR 52 pt centré en bas (x 144–196, y 10–62) ;
   *   - colonne de texte à gauche, bornée en largeur : nom/qualité ≤ 190 pt
   *     (jusqu'à la photo), valeurs ≤ 122 pt (jamais sous le QR).
   */
  private async construirePdf(
    cartes: { infos: InfosCarte; qr: Buffer; photo: Buffer | null }[],
    logo: Buffer | null = null,
  ): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.setTitle('Carte(s) de membre');
    doc.setProducer('assurance-sante-core-system');
    const police = await doc.embedFont(StandardFonts.Helvetica);
    const policeGras = await doc.embedFont(StandardFonts.HelveticaBold);
    // Logo embarqué UNE fois pour tout le document (lot : réutilisé sur chaque page).
    const imageLogo = await this.embarquerImage(doc, logo, 'logo');

    const L = 340;
    const H = 214;
    const MARGE = 14;
    const encre = rgb(0.1, 0.1, 0.16);
    const gris = rgb(0.42, 0.42, 0.48);
    const bleu = rgb(0.13, 0.29, 0.53);

    const HAUTEUR_BANDEAU = 40;
    const basBandeau = H - HAUTEUR_BANDEAU;
    // Photo 112 pt, bord droit à la marge (x 214–326) et centrée VERTICALEMENT
    // dans le corps de la carte (zone 0–174 sous le bandeau → y 31–143).
    const TAILLE_PHOTO = 112;
    const xPhoto = L - MARGE - TAILLE_PHOTO;
    const yPhoto = (basBandeau - TAILLE_PHOTO) / 2;
    const TAILLE_QR = 52; // = taille de l'ancienne photo
    const xQr = (L - TAILLE_QR) / 2;
    const yQr = 10;
    const largeurTexte = xPhoto - 10 - MARGE;
    const largeurValeurs = xQr - 8 - MARGE;

    // Filigrane : occupe TOUTE la zone libre à gauche de la photo, de la marge de
    // sécurité d'impression (8,5 pt) jusqu'au bord gauche de la photo, sans
    // jamais passer dessous (la photo, opaque, le masquerait). Proportions
    // conservées, au plus 85 % de la hauteur sous le bandeau.
    const OPACITE_FILIGRANE = 0.1;
    const SECURITE_IMPRESSION = 8.5;
    const largeurZoneFiligrane = xPhoto - SECURITE_IMPRESSION;
    let filigrane: { x: number; y: number; w: number; h: number } | null = null;
    if (imageLogo) {
      const echelle = Math.min(
        largeurZoneFiligrane / imageLogo.width,
        (basBandeau * 0.85) / imageLogo.height,
      );
      const w = imageLogo.width * echelle;
      const h = imageLogo.height * echelle;
      filigrane = {
        x: SECURITE_IMPRESSION + (largeurZoneFiligrane - w) / 2,
        y: (basBandeau - h) / 2,
        w,
        h,
      };
    }
    // Logo du bandeau (en plus du filigrane) : hauteur 22 pt max, largeur
    // 70 pt max, sur pastille blanche (un logo sombre reste lisible sur le bleu).
    let enTete: { w: number; h: number; pastille: number } | null = null;
    if (imageLogo) {
      const echelle = Math.min(22 / imageLogo.height, 70 / imageLogo.width);
      const w = imageLogo.width * echelle;
      enTete = { w, h: imageLogo.height * echelle, pastille: w + 8 };
    }

    for (const { infos, qr, photo } of cartes) {
      const page = doc.addPage([L, H]);
      page.drawRectangle({ x: 0, y: 0, width: L, height: H, color: rgb(0.98, 0.98, 1) });
      if (imageLogo && filigrane) {
        page.drawImage(imageLogo, { ...filigrane, width: filigrane.w, height: filigrane.h, opacity: OPACITE_FILIGRANE });
      }
      page.drawRectangle({ x: 0, y: basBandeau, width: L, height: HAUTEUR_BANDEAU, color: bleu });

      let xTitre = MARGE;
      if (imageLogo && enTete) {
        page.drawRectangle({
          x: 10,
          y: basBandeau + 5,
          width: enTete.pastille,
          height: HAUTEUR_BANDEAU - 10,
          color: rgb(1, 1, 1),
        });
        page.drawImage(imageLogo, {
          x: 10 + 4,
          y: basBandeau + (HAUTEUR_BANDEAU - enTete.h) / 2,
          width: enTete.w,
          height: enTete.h,
        });
        xTitre = 10 + enTete.pastille + 8;
      }
      const titre = this.ajuster(
        this.ascii(infos.organisation).toUpperCase(),
        policeGras,
        11,
        8,
        L - xTitre - MARGE,
      );
      page.drawText(titre.texte, {
        x: xTitre,
        y: H - 20,
        size: titre.taille,
        font: policeGras,
        color: rgb(1, 1, 1),
      });
      page.drawText('CARTE DE MEMBRE', {
        x: xTitre,
        y: H - 31,
        size: 6.5,
        font: police,
        color: rgb(0.82, 0.88, 1),
      });
      // Coordonnées de la société, sur la même ligne juste après « CARTE DE MEMBRE ».
      if (infos.contact) {
        const xContact = xTitre + police.widthOfTextAtSize('CARTE DE MEMBRE', 6.5) + 6;
        const contact = this.contactAjuste(infos.contact, police, L - MARGE - xContact);
        if (contact) {
          page.drawText(contact.texte, {
            x: xContact,
            y: H - 31,
            size: contact.taille,
            font: police,
            color: rgb(1, 1, 1),
          });
        }
      }

      await this.dessinerPhoto(doc, page, photo, xPhoto, yPhoto, TAILLE_PHOTO);

      let y = basBandeau - 24;
      const nom = this.ajuster(this.ascii(infos.nomComplet), policeGras, 17, 11, largeurTexte);
      page.drawText(nom.texte, { x: MARGE, y, size: nom.taille, font: policeGras, color: encre });
      y -= 14;
      const qualite = this.ajuster(this.ascii(infos.qualite), police, 8, 6.5, largeurTexte);
      page.drawText(qualite.texte, { x: MARGE, y, size: qualite.taille, font: police, color: gris });

      y -= 20;
      const ligne = (label: string, valeur: string) => {
        page.drawText(this.ascii(label), { x: MARGE, y, size: 7, font: police, color: gris });
        const v = this.ajuster(this.ascii(valeur), policeGras, 10.5, 8, largeurValeurs);
        page.drawText(v.texte, { x: MARGE, y: y - 12, size: v.taille, font: policeGras, color: encre });
        y -= 28;
      };
      ligne('N° DE CARTE', infos.numeroCarte);
      ligne('FORMULE', infos.formule);
      ligne('VALABLE JUSQU’AU', infos.dateValidite);

      const qrImg = await doc.embedPng(qr);
      page.drawImage(qrImg, { x: xQr, y: yQr, width: TAILLE_QR, height: TAILLE_QR });
      const ref = this.ascii(infos.numeroReference);
      page.drawText(ref, {
        x: L - MARGE - police.widthOfTextAtSize(ref, 6.5),
        y: yQr,
        size: 6.5,
        font: police,
        color: gris,
      });
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  /** PNG/JPEG → image embarquée ; tout autre cas (absent, WEBP, corrompu) → null. */
  private async embarquerImage(doc: PDFDocument, octets: Buffer | null, quoi: string) {
    if (!octets) return null;
    const format = formatImagePdf(octets);
    if (!format) {
      this.logger.warn(`${quoi} dans un format non supporté par le PDF (PNG/JPEG uniquement) — ignoré.`);
      return null;
    }
    try {
      return format === 'png' ? await doc.embedPng(octets) : await doc.embedJpg(octets);
    } catch (error) {
      this.logger.warn(
        `${quoi} non embarquable (${error instanceof Error ? error.message : 'erreur inconnue'}) — ignoré.`,
      );
      return null;
    }
  }

  /**
   * Photo CARRÉE (coins droits, aucun contour) : recadrée « cover » dans le
   * carré si elle est embarquable, sinon une silhouette neutre sur fond gris
   * clair — jamais d'erreur, jamais d'image cassée. Un échec d'embarquement
   * (octets PNG/JPEG corrompus) retombe aussi sur la silhouette.
   */
  private async dessinerPhoto(
    doc: PDFDocument,
    page: PDFPage,
    photo: Buffer | null,
    x: number,
    y: number,
    c: number,
  ): Promise<void> {
    const image = await this.embarquerImage(doc, photo, 'Photo');

    // Découpe au carré exact : un portrait non carré est rogné, jamais déformé.
    page.pushOperators(
      pushGraphicsState(),
      moveTo(x, y),
      lineTo(x + c, y),
      lineTo(x + c, y + c),
      lineTo(x, y + c),
      closePath(),
      clip(),
      endPath(),
    );
    if (image) {
      const echelle = c / Math.min(image.width, image.height);
      const w = image.width * echelle;
      const h = image.height * echelle;
      page.drawImage(image, { x: x + (c - w) / 2, y: y + (c - h) / 2, width: w, height: h });
    } else {
      const gris = rgb(0.7, 0.72, 0.78);
      page.drawRectangle({ x, y, width: c, height: c, color: rgb(0.9, 0.91, 0.94) });
      page.drawCircle({ x: x + c / 2, y: y + c * 0.6, size: c * 0.17, color: gris });
      page.drawEllipse({ x: x + c / 2, y: y + c * 0.08, xScale: c * 0.32, yScale: c * 0.27, color: gris });
    }
    page.pushOperators(popGraphicsState());
  }

  /** Réduit la taille de police jusqu'à `min`, puis tronque avec « ... » pour
   * tenir dans `largeur` — le texte ne déborde jamais sur la photo/QR. */
  /**
   * Coordonnées du bandeau : réduites jusqu'à 5 pt pour tenir ; sinon on garde
   * la seule partie qui tient ENTIÈRE (e-mail, puis téléphone) — une adresse
   * tronquée par « ... » serait inutilisable. null si rien ne tient.
   */
  private contactAjuste(
    contact: string,
    font: PDFFont,
    largeur: number,
  ): { texte: string; taille: number } | null {
    const candidats = [contact, ...contact.split('  ·  ').reverse()].map(
      (c) => `·  ${this.ascii(c)}`,
    );
    for (const c of candidats) {
      for (let t = 6.5; t >= 5; t -= 0.5) {
        if (font.widthOfTextAtSize(c, t) <= largeur) return { texte: c, taille: t };
      }
    }
    return null;
  }

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

  /**
   * pdf-lib (Helvetica/WinAnsi) : la typographie courante est d'abord ramenée à
   * son équivalent encodable — sans quoi l'apostrophe de « N’Guessan » ou
   * « JUSQU’AU » (U+2019) disparaissait purement et simplement — puis on retire
   * le reste de ce qui n'est pas encodable.
   */
  private ascii(texte: string): string {
    return texte
      .normalize('NFC')
      .replace(/[‘’‚‛ʼ]/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/œ/g, 'oe')
      .replace(/Œ/g, 'OE')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\u0000-ÿ]/g, '');
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

  /**
   * Octets du logo de l'organisation (`organisations.logo_url`, bucket public
   * `logos`) — `null` si aucun logo ou si le téléchargement échoue : la carte
   * est alors générée normalement, sans logo, jamais bloquée.
   */
  private async chargerLogo(url: string | null | undefined): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`Logo introuvable pour la carte (${res.status}) : ${url} — carte sans logo.`);
        return null;
      }
      return await this.rognerMarges(Buffer.from(await res.arrayBuffer()));
    } catch (error) {
      this.logger.warn(
        `Téléchargement du logo impossible (${error instanceof Error ? error.message : 'erreur inconnue'}) — carte sans logo.`,
      );
      return null;
    }
  }

  /**
   * Retire les marges transparentes ou unies d'un logo (couleur du pixel en
   * haut à gauche, tolérance 10) : beaucoup de logos importés en contiennent
   * (ex. 150 px vides sur 406), ce qui rapetissait le filigrane et le logo du
   * bandeau. Sortie PNG (transparence conservée). En mémoire seulement — le
   * fichier stocké n'est pas modifié. Échec, ou image entièrement unie →
   * logo d'origine inchangé.
   */
  private async rognerMarges(logo: Buffer): Promise<Buffer> {
    try {
      const { data, info } = await sharp(logo)
        .trim({ threshold: 10 })
        .png()
        .toBuffer({ resolveWithObject: true });
      return info.width > 0 && info.height > 0 ? data : logo;
    } catch (error) {
      this.logger.debug(
        `Logo non rogné (${error instanceof Error ? error.message : 'erreur inconnue'}) — utilisé tel quel.`,
      );
      return logo;
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
    // La société ne génère aucune carte : elle PROPOSE, l'assureur valide (et la carte est générée à la validation).
    throw new ForbiddenException(
      "La génération des cartes est réservée au personnel ASSUREUR habilité, ou à l'adhérent pour sa propre carte.",
    );
  }

  private async chargerAdherentComplet(
    ctx: ContexteAppelant,
    id: string,
  ): Promise<AdherentComplet> {
    const adherent = await this.prisma.adherent.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null },
      include: {
        organisation: { select: { nom: true, logoUrl: true, telephoneContact: true, emailContact: true } },
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
    organisation: { select: { nom: true, logoUrl: true, telephoneContact: true, emailContact: true } };
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
