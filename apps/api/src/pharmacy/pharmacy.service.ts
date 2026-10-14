import { randomInt } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AdjudicationClientService,
  MESSAGES_INDISPONIBILITE,
} from '../adjudication-client/adjudication-client.service';
import Decimal from 'decimal.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { ClaimsService } from '../claims/claims.service';
import {
  ROLE_PHARMACIEN_CONSEIL,
  STATUTS_CONTESTATION_EN_LITIGE,
} from '../contestation/contestation.types';
import { IdentityService } from '../identity/identity.service';
import { masquerEmail, masquerTelephone } from '../accueil/accueil-carte.service';
import { AdherentService } from '../member/adherent.service';
import { NotificationCodeService, type CanalCode } from '../notifications/notification-code.service';
import { bornesPage, conditionRecherche, filtrePeriode, versPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import {
  DefinirPrixStockDto,
  CreerMedicamentCatalogueDto,
  LigneChoisieDto,
  ListerDispensationsQueryDto,
  ModifierMedicamentListeDto,
  ListerMesDispensationsQueryDto,
  SoumettreFactureMensuelleDto,
  SubstituerMedicamentDto,
  ValiderCodeDispensationDto,
  ValiderFactureMensuelleDto,
} from './dto/pharmacy.dto';
import {
  ALPHABET_CODE,
  CATEGORIE_ACTE_PHARMACIE,
  ContexteAppelant,
  LONGUEUR_CODE,
  ROLES_ADHERENT,
  ROLES_FACTURATION_MENSUELLE,
  ROLES_PHARMACIE,
  ROLE_COMPTABLE_FACTURE_MENSUELLE,
  ROLE_PHARMACIEN_SEUL,
  STATUTS_DISPENSATION_MODIFIABLE,
} from './pharmacy.types';

/** Seuil (%) de majoration d'une pharmacie au-delà duquel le comptoir alerte (paramètre de la plateforme). */
const CLE_SEUIL_MAJORATION = 'majoration_maximale_pharmacie_pourcent';
const SEUIL_MAJORATION_DEFAUT = 20;

type Db = PrismaService | Prisma.TransactionClient;

/**
 * PharmacyService — révision majeure du flux pharmacie (clarification
 * métier) : verrou PAR LIGNE de médicament, pas par ordonnance entière
 * (PROMPT 19). Une même ordonnance peut être servie par plusieurs pharmacies
 * différentes, une ligne donnée jamais deux fois.
 *
 * `rechercherPrescriptionsParCarte` identifie le patient par son numéro de
 * carte — PAS un code secret (toute pharmacie du réseau peut consulter les
 * ordonnances actives d'un porteur de carte, comme en pratique). L'anti-fraude
 * porte désormais sur le PAIEMENT (code de confirmation envoyé au patient),
 * pas sur la lecture du contenu.
 */
@Injectable()
export class PharmacyService {
  private readonly logger = new Logger(PharmacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly claims: ClaimsService,
    private readonly adjudication: AdjudicationClientService,
    private readonly adherents: AdherentService,
    private readonly notifications: NotificationCodeService,
  ) {}

  private contactsMasques(t: { email: string | null; telephone: string | null }) {
    const canaux = this.notifications.canauxDisponibles();
    const liste: { canal: CanalCode; masque: string; actif: boolean; avertissement: string | null }[] = [];
    if (t.email) liste.push({ canal: 'EMAIL', masque: masquerEmail(t.email), actif: canaux.EMAIL.actif, avertissement: canaux.EMAIL.raison ?? null });
    if (t.telephone) liste.push({ canal: 'SMS', masque: masquerTelephone(t.telephone), actif: canaux.SMS.actif, avertissement: canaux.SMS.raison ?? null });
    return liste;
  }

  /** Identité du patient pour le comptoir : mêmes informations que la fiche d'accueil de l'établissement. */
  private async fichePatient(
    adherent: {
      nom: string; prenom: string; numeroCarte: string; statut: string; dateNaissance: Date; sexe: string | null; photoUrl: string | null;
      email: string | null; telephone: string | null;
      souscripteur: { nom: string }; police: { numeroPolice: string; produit: { nom: string } } | null;
    } | null,
    beneficiaire: {
      nom: string; prenom: string; numeroCarte: string | null; statut: string; dateNaissance: Date; sexe: string | null; photoUrl: string | null; lienParente: string;
      adherent: { email: string | null; telephone: string | null; souscripteur: { nom: string }; police: { numeroPolice: string; produit: { nom: string } } | null };
    } | null,
  ) {
    const membre = (adherent ?? beneficiaire)!;
    const titulaire = adherent ?? beneficiaire!.adherent;
    return {
      qualite: adherent ? ('TITULAIRE' as const) : ('BENEFICIAIRE' as const),
      nom: membre.nom,
      prenom: membre.prenom,
      numeroCarte: membre.numeroCarte,
      statut: membre.statut,
      dateNaissance: membre.dateNaissance.toISOString().slice(0, 10),
      sexe: membre.sexe ?? null,
      lien: beneficiaire ? beneficiaire.lienParente : 'TITULAIRE',
      photoUrl: await this.adherents.urlPhotoSignee(membre.photoUrl),
      societe: titulaire.souscripteur.nom,
      police: titulaire.police ? titulaire.police.numeroPolice : null,
      produit: titulaire.police ? titulaire.police.produit.nom : null,
      // contacts ENREGISTRÉS (ceux du titulaire), masqués : jamais saisis au comptoir
      contacts: this.contactsMasques(titulaire),
    };
  }

  // --- Recherche par carte -----------------------------------------

  async rechercherPrescriptionsParCarte(user: AuthenticatedUser, numeroCarte: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const carte = numeroCarte.trim();
    const adherent = await this.prisma.adherent.findFirst({
      where: { numeroCarte: carte, organisationId: ctx.organisationId, deletedAt: null },
      select: {
        id: true, nom: true, prenom: true, numeroCarte: true, statut: true, dateNaissance: true, sexe: true, photoUrl: true,
        email: true, telephone: true,
        souscripteur: { select: { nom: true } },
        police: { select: { numeroPolice: true, produit: { select: { nom: true } } } },
      },
    });
    const beneficiaire = adherent
      ? null
      : await this.prisma.beneficiaire.findFirst({
          where: {
            numeroCarte: carte,
            deletedAt: null,
            adherent: { organisationId: ctx.organisationId, deletedAt: null },
          },
          select: {
            id: true,
            nom: true,
            prenom: true,
            numeroCarte: true,
            statut: true,
            adherentId: true,
            dateNaissance: true,
            sexe: true,
            lienParente: true,
            photoUrl: true,
            adherent: {
              select: {
                email: true,
                telephone: true,
                souscripteur: { select: { nom: true } },
                police: { select: { numeroPolice: true, produit: { select: { nom: true } } } },
              },
            },
          },
        });

    if (!adherent && !beneficiaire) {
      throw new NotFoundException('Aucun adhérent ou bénéficiaire pour ce numéro de carte.');
    }

    const dossiersWhere = adherent
      ? { adherentId: adherent.id }
      : { beneficiaireId: beneficiaire!.id };

    const ordonnances = await this.prisma.ordonnance.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        statut: { in: ['ACTIVE', 'PARTIELLEMENT_DELIVREE'] },
        dossier: dossiersWhere,
      },
      include: {
        dossier: { select: { numeroTraitement: true } },
        lignesOrdonnance: {
          select: {
            id: true,
            denominationMedicament: true,
            dosage: true,
            posologie: true,
            duree: true,
            quantitePrescrite: true,
            statut: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { datePrescription: 'desc' },
    });

    const refs = await this.prixReferenceParDenomination(
      ctx.organisationId,
      ordonnances.flatMap((o) => o.lignesOrdonnance.map((l) => l.denominationMedicament)),
    );
    const seuilMajorationPourcent = await this.seuilMajorationPourcent();

    return {
      seuilMajorationPourcent,
      patient: await this.fichePatient(adherent, beneficiaire),
      ordonnances: ordonnances.map((o) => ({
        id: o.id,
        numeroTraitement: o.dossier.numeroTraitement,
        statut: o.statut,
        datePrescription: o.datePrescription,
        dateValidite: o.dateValidite,
        lignes: o.lignesOrdonnance.map((l) => ({
          id: l.id,
          denominationMedicament: l.denominationMedicament,
          dosage: l.dosage,
          posologie: l.posologie,
          duree: l.duree,
          quantitePrescrite: l.quantitePrescrite,
          statut: l.statut,
          prixReference: refs.get(l.denominationMedicament.trim().toLowerCase())?.toFixed(2) ?? null,
        })),
      })),
    };
  }

  // --- Stock (lecture : les 3 rôles PHARMACIE ; écriture : pharmacien seul) -

  /**
   * Lecture ouverte aux 3 rôles PHARMACIE de la pharmacie (la caissière doit
   * pouvoir vérifier, au moment de la dispensation, si un médicament est en
   * stock et à quel prix — clarification métier). L'ÉCRITURE reste réservée
   * au seul pharmacien (`definirPrixStock`, inchangé).
   */
  async listerStock(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);
    return this.prisma.stockMedicamentPharmacie.findMany({
      where: { pharmacieId: ctx.pharmacieId! },
      orderBy: { denominationMedicament: 'asc' },
    });
  }

  /**
   * Disponibilité d'un médicament dans la pharmacie (ADR-007, lot comptoir) : le stock ne porte plus de
   * prix — le prix est saisi au comptoir par le caissier, à partir du prix national de référence.
   */
  async definirPrixStock(user: AuthenticatedUser, dto: DefinirPrixStockDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacien(ctx);

    // Le médicament est CHOISI dans la base : sa dénomination vient du catalogue, jamais d'une saisie libre.
    if (dto.medicamentId) {
      const m = await this.medicamentRemboursable(ctx.organisationId, dto.medicamentId);
      const denominationMedicament = this.libelleMedicament(m);
      return this.prisma.stockMedicamentPharmacie.upsert({
        where: { pharmacieId_denominationMedicament: { pharmacieId: ctx.pharmacieId!, denominationMedicament } },
        create: {
          pharmacieId: ctx.pharmacieId!,
          denominationMedicament,
          catalogueNationalId: m.id,
          disponible: dto.disponible ?? true,
        },
        update: {
          catalogueNationalId: m.id,
          ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
          dateMaj: new Date(),
        },
      });
    }

    // Ligne déjà présente (ancienne saisie) : mise à jour de sa disponibilité seulement, aucune création.
    const existante = dto.denominationMedicament
      ? await this.prisma.stockMedicamentPharmacie.findFirst({
          where: { pharmacieId: ctx.pharmacieId!, denominationMedicament: dto.denominationMedicament },
          select: { id: true },
        })
      : null;
    if (!existante) {
      throw new BadRequestException('Choisissez le médicament dans la liste de la base : la saisie libre n’est pas acceptée.');
    }
    return this.prisma.stockMedicamentPharmacie.update({
      where: { id: existante.id },
      data: { ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}), dateMaj: new Date() },
    });
  }

  /**
   * Recherche d'un médicament dans la base (catalogue national homologué ET activé par l'assureur de la pharmacie) — alimente les
   * champs « médicament » du pharmacien (disponibilité, substitution). Aucun prix. 20 résultats au plus.
   */
  async rechercherMedicaments(user: AuthenticatedUser, q: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPeutSubstituer(ctx);
    const terme = q.trim();
    if (terme.length < 2) return [];
    const recherche = conditionRecherche(terme, [
      Prisma.sql`n.denomination_commune`,
      Prisma.sql`n.nom_commercial`,
      Prisma.sql`n.dosage`,
      Prisma.sql`n.code_ean`,
    ]);
    const lignes = await this.prisma.$queryRaw<
      { id: string; denomination_commune: string; nom_commercial: string | null; dosage: string | null; forme: string | null }[]
    >(Prisma.sql`
      SELECT n.id, n.denomination_commune, n.nom_commercial, n.dosage, n.forme
        FROM referentiel_national_medicaments n
       WHERE n.deleted_at IS NULL AND n.statut_homologation = 'HOMOLOGUE'
         AND EXISTS (SELECT 1 FROM medicaments m
                      WHERE m.organisation_id = ${ctx.organisationId}::uuid AND m.deleted_at IS NULL
                        AND m.statut_homologation = 'HOMOLOGUE' AND m.catalogue_national_id = n.id)
         AND ${recherche}
       ORDER BY n.denomination_commune, n.nom_commercial
       LIMIT 20`);
    return lignes.map((m) => ({
      id: m.id,
      denominationCommune: m.denomination_commune,
      nomCommercial: m.nom_commercial,
      dosage: m.dosage,
      forme: m.forme,
    }));
  }

  // --- Liste des médicaments remboursables de la pharmacie (ADR-009) -------

  /** Libellé d'un médicament dans une ordonnance et dans le stock : « DCI (nom commercial) » ou la seule DCI — le même que celui choisi à la prescription. */
  private libelleMedicament(m: { denominationCommune: string; nomCommercial: string | null }): string {
    return m.nomCommercial && m.nomCommercial.toLowerCase() !== m.denominationCommune.toLowerCase()
      ? `${m.denominationCommune} (${m.nomCommercial})`
      : m.denominationCommune;
  }

  /**
   * Médicament du catalogue national, homologué ET activé par l'organisation de la pharmacie (donc remboursable) ; 404 sinon.
   * Seul le contenu médicament est concerné : aucun acte n'entre dans cette liste.
   */
  private async medicamentRemboursable(organisationId: string, nationalId: string) {
    const m = await this.prisma.referentielNationalMedicament.findFirst({
      where: {
        id: nationalId,
        deletedAt: null,
        statutHomologation: 'HOMOLOGUE',
      },
      select: { id: true, denominationCommune: true, nomCommercial: true },
    });
    const active = m
      ? await this.prisma.medicament.findFirst({
          where: { organisationId, catalogueNationalId: nationalId, deletedAt: null, statutHomologation: 'HOMOLOGUE' },
          select: { id: true },
        })
      : null;
    if (!m || !active) {
      throw new NotFoundException("Médicament introuvable parmi les médicaments remboursables de votre assureur.");
    }
    return m;
  }

  /**
   * « Médicaments remboursables » de la pharmacie : les médicaments du CATALOGUE NATIONAL homologués et activés par son assureur
   * (jamais d'acte), chacun marqué « dans ma liste » (ajouté par le pharmacien) avec sa disponibilité et sa note. Lecture ouverte aux
   * trois rôles pharmacie ; le prix national est montré en lecture seule.
   */
  async listerMedicamentsRemboursables(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);
    const [medicaments, liste] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          denomination_commune: string;
          nom_commercial: string | null;
          dosage: string | null;
          forme: string | null;
          classe_therapeutique: string | null;
          remboursable: boolean;
          taux_remboursement_std: Prisma.Decimal | null;
          prix_reference_xof: Prisma.Decimal | null;
          medicament_essentiel: boolean;
        }[]
      >(Prisma.sql`
        SELECT n.id, n.denomination_commune, n.nom_commercial, n.dosage, n.forme, n.classe_therapeutique, n.remboursable,
               n.taux_remboursement_std, n.prix_reference_xof, n.medicament_essentiel
          FROM referentiel_national_medicaments n
         WHERE n.deleted_at IS NULL AND n.statut_homologation = 'HOMOLOGUE'
           AND EXISTS (SELECT 1 FROM medicaments m
                        WHERE m.organisation_id = ${ctx.organisationId}::uuid AND m.deleted_at IS NULL
                          AND m.statut_homologation = 'HOMOLOGUE' AND m.catalogue_national_id = n.id)
         ORDER BY n.denomination_commune, n.nom_commercial`),
      this.prisma.stockMedicamentPharmacie.findMany({
        where: { pharmacieId: ctx.pharmacieId!, catalogueNationalId: { not: null } },
        select: { catalogueNationalId: true, disponible: true, note: true, dateMaj: true },
      }),
    ]);
    const parId = new Map(liste.map((l) => [l.catalogueNationalId!, l]));
    return medicaments.map((m) => {
      const l = parId.get(m.id);
      return {
        id: m.id,
        denominationCommune: m.denomination_commune,
        nomCommercial: m.nom_commercial,
        dosage: m.dosage,
        forme: m.forme,
        classeTherapeutique: m.classe_therapeutique,
        remboursable: m.remboursable,
        tauxRemboursementStd: m.taux_remboursement_std === null ? null : m.taux_remboursement_std.toString(),
        prixReferenceXof: m.prix_reference_xof === null ? null : m.prix_reference_xof.toString(),
        medicamentEssentiel: m.medicament_essentiel,
        dansMaListe: !!l,
        disponible: l ? l.disponible : null,
        note: l ? l.note : null,
        dateMajListe: l ? l.dateMaj : null,
      };
    });
  }

  /**
   * Le pharmacien met à jour le CATALOGUE NATIONAL en y ajoutant un nouveau médicament avec son prix national. Il est créé « homologué »
   * mais n'a AUCUN effet financier tant qu'un assureur ne l'a pas activé (ADR-009) : pas de prescription, de dispensation ni de
   * remboursement avant cette activation. Ajout seul — un médicament existant du catalogue n'est jamais modifié par la pharmacie (ni son prix).
   * Un doublon (même DCI, nom commercial, dosage et forme) est refusé. Origine tracée sur la fiche (`sourceListe`), au journal et à l'audit.
   */
  async creerMedicamentCatalogue(user: AuthenticatedUser, dto: CreerMedicamentCatalogueDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacien(ctx);
    await this.assertPharmacieNonArchivee(ctx.pharmacieId!, 'aucun ajout au catalogue');
    const net = (v?: string) => v?.trim() || null;
    const dci = dto.denominationCommune.trim();
    const nom = net(dto.nomCommercial);
    const dosage = net(dto.dosage);
    const forme = net(dto.forme);
    const doublon = await this.prisma.referentielNationalMedicament.findFirst({
      where: {
        deletedAt: null,
        denominationCommune: { equals: dci, mode: 'insensitive' },
        nomCommercial: nom === null ? null : { equals: nom, mode: 'insensitive' },
        dosage: dosage === null ? null : { equals: dosage, mode: 'insensitive' },
        forme: forme === null ? null : { equals: forme, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (doublon) throw new ConflictException('Ce médicament existe déjà dans le catalogue national.');
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.referentielNationalMedicament.create({
        data: {
          denominationCommune: dci,
          nomCommercial: nom,
          dosage,
          forme,
          classeTherapeutique: net(dto.classeTherapeutique),
          remboursable: true,
          prixReferenceXof: new Decimal(dto.prixReferenceXof).toFixed(2),
          statutHomologation: 'HOMOLOGUE',
          sourceListe: 'PHARMACIE',
        },
      });
      await this.audit(tx, ctx.userId, 'CREATION_MEDICAMENT_CATALOGUE_PAR_PHARMACIEN', 'referentiel_national_medicaments', m.id, {
        dci,
        prixReferenceXof: new Decimal(dto.prixReferenceXof).toFixed(2),
        pharmacieId: ctx.pharmacieId,
      });
      return m;
    });
  }

  /** Ajoute un médicament du catalogue à la liste de la pharmacie (pharmacien) — le catalogue n'est jamais modifié. */
  async ajouterMedicamentAMaListe(user: AuthenticatedUser, nationalId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacien(ctx);
    const m = await this.medicamentRemboursable(ctx.organisationId, nationalId);
    const existant = await this.prisma.stockMedicamentPharmacie.findFirst({
      where: { pharmacieId: ctx.pharmacieId!, catalogueNationalId: nationalId },
      select: { id: true },
    });
    if (existant) throw new ConflictException('Ce médicament figure déjà dans votre liste.');
    const libelle = this.libelleMedicament(m);
    // une ligne de stock antérieure, saisie à la main sous le même libellé, est rattachée au catalogue plutôt que dupliquée
    return this.prisma.stockMedicamentPharmacie.upsert({
      where: { pharmacieId_denominationMedicament: { pharmacieId: ctx.pharmacieId!, denominationMedicament: libelle } },
      create: { pharmacieId: ctx.pharmacieId!, denominationMedicament: libelle, catalogueNationalId: nationalId, disponible: true },
      update: { catalogueNationalId: nationalId, dateMaj: new Date() },
    });
  }

  /** Modifie la disponibilité et/ou la note d'un médicament de la liste (pharmacien). Aucun tarif, aucune donnée du catalogue. */
  async modifierMedicamentDeMaListe(user: AuthenticatedUser, nationalId: string, dto: ModifierMedicamentListeDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacien(ctx);
    const ligne = await this.prisma.stockMedicamentPharmacie.findFirst({
      where: { pharmacieId: ctx.pharmacieId!, catalogueNationalId: nationalId },
      select: { id: true },
    });
    if (!ligne) throw new NotFoundException("Ce médicament n'est pas dans votre liste : ajoutez-le d'abord.");
    return this.prisma.stockMedicamentPharmacie.update({
      where: { id: ligne.id },
      data: {
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
        ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        dateMaj: new Date(),
      },
    });
  }

  /** Retire un médicament de la liste de la pharmacie (pharmacien) : il redevient « disponible par défaut », sans trace de note. */
  async retirerMedicamentDeMaListe(user: AuthenticatedUser, nationalId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacien(ctx);
    const { count } = await this.prisma.stockMedicamentPharmacie.deleteMany({
      where: { pharmacieId: ctx.pharmacieId!, catalogueNationalId: nationalId },
    });
    if (count === 0) throw new NotFoundException("Ce médicament n'est pas dans votre liste.");
    return { retire: true };
  }

  // --- Prix national de référence et seuil de majoration ------------------

  /** Seuil de majoration (%) : paramètre de la plateforme, 20 par défaut. */
  private async seuilMajorationPourcent(): Promise<number> {
    const p = await this.prisma.parametrePlateforme.findUnique({ where: { cle: CLE_SEUIL_MAJORATION } });
    const v = p ? Number(p.valeur) : NaN;
    return Number.isFinite(v) && v >= 0 ? v : SEUIL_MAJORATION_DEFAUT;
  }

  /**
   * Prix national de référence par dénomination saisie (insensible à la casse), dans cet ordre :
   *  1. le NOM COMMERCIAL exact d'un produit (la liste nationale porte un prix par produit) ;
   *  2. la DCI : plusieurs produits partagent une DCI à des prix différents, on retient alors le plus
   *     ÉLEVÉ (bénéfice du doute : une alerte de majoration ne se déclenche que si même le produit le
   *     plus cher de la DCI est dépassé).
   * Médicaments homologués de l'organisation d'abord, catalogue national ensuite. Absent = aucune alerte.
   */
  private async prixReferenceParDenomination(
    organisationId: string,
    denominations: string[],
  ): Promise<Map<string, Decimal>> {
    const uniques = [...new Set(denominations.map((d) => d.trim()).filter(Boolean))];
    const clef = (d: string) => d.trim().toLowerCase();
    // Une ligne d'ordonnance prescrite depuis le catalogue porte le libellé « DCI (nom commercial) » : on retrouve aussi le produit exact
    // par ce libellé, sinon le prix national (et l'alerte de majoration) n'étaient jamais repris pour ces médicaments.
    const condition = (d: string) => {
      const m = /^(.+?)\s*\((.+)\)$/.exec(d);
      return [
        { denominationCommune: { equals: d, mode: 'insensitive' as const } },
        { nomCommercial: { equals: d, mode: 'insensitive' as const } },
        ...(m ? [{ denominationCommune: { equals: m[1], mode: 'insensitive' as const }, nomCommercial: { equals: m[2], mode: 'insensitive' as const } }] : []),
      ];
    };
    const ou = uniques.flatMap(condition);
    const resultat = new Map<string, Decimal>();
    const retenir = (rows: { denominationCommune: string; nomCommercial: string | null; prixReferenceXof: unknown }[]) => {
      const nom = new Map<string, Decimal>();
      const dci = new Map<string, Decimal>();
      for (const m of rows) {
        const prix = new Decimal(String(m.prixReferenceXof));
        if (m.nomCommercial) {
          nom.set(clef(m.nomCommercial), prix);
          nom.set(clef(`${m.denominationCommune} (${m.nomCommercial})`), prix);
        }
        const k = clef(m.denominationCommune);
        if (!dci.has(k) || prix.gt(dci.get(k)!)) dci.set(k, prix);
      }
      for (const d of uniques) {
        if (resultat.has(clef(d))) continue;
        const p = nom.get(clef(d)) ?? dci.get(clef(d));
        if (p) resultat.set(clef(d), p);
      }
    };
    const locaux = await this.prisma.medicament.findMany({
      where: { organisationId, deletedAt: null, statutHomologation: 'HOMOLOGUE', prixReferenceXof: { not: null }, OR: ou },
      select: { denominationCommune: true, nomCommercial: true, prixReferenceXof: true },
    });
    retenir(locaux);
    const manquants = uniques.filter((d) => !resultat.has(clef(d)));
    if (manquants.length > 0) {
      const nationaux = await this.prisma.referentielNationalMedicament.findMany({
        where: {
          statutHomologation: 'HOMOLOGUE',
          deletedAt: null,
          prixReferenceXof: { not: null },
          OR: manquants.flatMap(condition),
        },
        select: { denominationCommune: true, nomCommercial: true, prixReferenceXof: true },
      });
      retenir(nationaux);
    }
    return resultat;
  }

  // --- Préparation d'une dispensation (par ligne) -------------------

  /**
   * Choisit des lignes DISPONIBLES d'une ordonnance, calcule le montant depuis
   * le stock de LA pharmacie appelante (`ctx.pharmacieId`, jamais un paramètre
   * client), génère le code de confirmation — envoyé à l'ADHÉRENT uniquement
   * (jamais à la pharmacie, même principe que les 4 codes déjà construits).
   * Les lignes ne passent PAS à SERVIE ici : seul le paiement confirmé
   * verrouille (`confirmerPaiementDispensation`).
   */
  async preparerDispensation(
    user: AuthenticatedUser,
    ordonnanceId: string,
    lignesChoisies: LigneChoisieDto[],
    canal?: CanalCode,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);
    const pharmacieId = ctx.pharmacieId!;
    await this.assertPharmacieNonArchivee(pharmacieId, 'aucune nouvelle dispensation');

    const ordonnance = await this.prisma.ordonnance.findFirst({
      where: { id: ordonnanceId, organisationId: ctx.organisationId, deletedAt: null },
      include: {
        dossier: {
          select: {
            adherentId: true,
            beneficiaireId: true,
            policeId: true,
            police: { select: { produitId: true } },
          },
        },
      },
    });
    if (!ordonnance) {
      throw new NotFoundException('Ordonnance introuvable.');
    }
    if (['EXPIREE', 'ANNULEE'].includes(ordonnance.statut)) {
      throw new ConflictException(`Ordonnance ${ordonnance.statut.toLowerCase()} — dispensation impossible.`);
    }

    // Canal d'envoi du code : le contact vient de la fiche du titulaire, jamais du client.
    let destinataire: string | null = null;
    if (canal) {
      const titulaire = await this.prisma.adherent.findFirst({
        where: ordonnance.dossier.adherentId
          ? { id: ordonnance.dossier.adherentId }
          : { beneficiaires: { some: { id: ordonnance.dossier.beneficiaireId! } } },
        select: { email: true, telephone: true },
      });
      destinataire = (canal === 'EMAIL' ? titulaire?.email : titulaire?.telephone) ?? null;
      if (!destinataire) {
        throw new ConflictException(
          canal === 'EMAIL' ? 'Aucune adresse e-mail n’est enregistrée sur la fiche.' : 'Aucun numéro de téléphone n’est enregistré sur la fiche.',
        );
      }
      if (canal === 'SMS' && !this.notifications.smsActif()) {
        throw new ConflictException('SMS indisponible : fournisseur non configuré.');
      }
    }

    // Part assurance / part patient — même logique que
    // PreauthorizationService.simulerMontantActe (garanties.tauxCouverture,
    // catégorie PHARMACIE, plafond par acte éventuel). Une seule garantie
    // pour toute la dispensation : toutes les lignes viennent de la même
    // ordonnance -> même dossier -> même police -> même produit.
    const garantiePharmacie = await this.prisma.garantie.findFirst({
      where: {
        produitId: ordonnance.dossier.police.produitId,
        categorieActe: CATEGORIE_ACTE_PHARMACIE,
        deletedAt: null,
      },
    });

    const lignes = await this.prisma.ligneOrdonnance.findMany({
      where: { id: { in: lignesChoisies.map((l) => l.ligneOrdonnanceId) }, ordonnanceId },
    });
    if (lignes.length !== lignesChoisies.length) {
      throw new BadRequestException("Une ou plusieurs lignes n'appartiennent pas à cette ordonnance.");
    }
    const dejaServies = lignes.filter((l) => l.statut !== 'DISPONIBLE');
    if (dejaServies.length > 0) {
      throw new ConflictException(
        `Ligne(s) déjà servie(s), non disponible(s) : ${dejaServies.map((l) => l.denominationMedicament).join(', ')}.`,
      );
    }

    // Prix PRATIQUÉ par la pharmacie, saisi par le caissier (jamais lu dans une base de tarifs de la
    // pharmacie). Seul garde-fou : le médicament marqué indisponible dans SA pharmacie est refusé ; la
    // majoration par rapport au prix national unique de référence déclenche une ALERTE (jamais un blocage).
    const stock = await this.prisma.stockMedicamentPharmacie.findMany({
      where: {
        pharmacieId,
        denominationMedicament: { in: lignes.map((l) => l.denominationMedicament) },
      },
    });
    const parDenomination = new Map(stock.map((s) => [s.denominationMedicament, s]));
    const refs = await this.prixReferenceParDenomination(ctx.organisationId, lignes.map((l) => l.denominationMedicament));
    const seuil = await this.seuilMajorationPourcent();

    const detail: {
      ligne: (typeof lignes)[number];
      quantite: number;
      prixUnitaire: Decimal;
      montantLigne: Decimal;
      montantAssurance: Decimal;
      montantPatient: Decimal;
      prixReference: Decimal | null;
      majorationPourcent: Decimal | null;
      majorationAnormale: boolean;
    }[] = [];
    for (const choix of lignesChoisies) {
      const ligne = lignes.find((l) => l.id === choix.ligneOrdonnanceId)!;
      const s = parDenomination.get(ligne.denominationMedicament);
      if (s && !s.disponible) {
        throw new ConflictException(`Médicament indisponible dans votre pharmacie : ${ligne.denominationMedicament}.`);
      }
      const quantite = choix.quantite ?? ligne.quantitePrescrite;
      const prixUnitaire = new Decimal(choix.prixUnitaire).toDecimalPlaces(2);
      const montantLigne = prixUnitaire.mul(quantite);
      const prixReference = refs.get(ligne.denominationMedicament.trim().toLowerCase()) ?? null;
      const majorationPourcent =
        prixReference && prixReference.gt(0)
          ? prixUnitaire.div(prixReference).sub(1).mul(100).toDecimalPlaces(2)
          : null;
      detail.push({
        ligne, quantite, prixUnitaire, montantLigne,
        montantAssurance: new Decimal(0),
        montantPatient: montantLigne,
        prixReference,
        majorationPourcent,
        majorationAnormale: majorationPourcent !== null && majorationPourcent.gt(seuil),
      });
    }
    const montantTotal = detail.reduce((acc, d) => acc.add(d.montantLigne), new Decimal(0));

    // Part assurance CALCULÉE PAR LE MICROSERVICE JAVA (ADR-005) : la dispensation
    // est UN acte (franchise, taux, plafond par acte, plafond annuel restant) —
    // exactement comme la réclamation adjugée au paiement. Sans garantie PHARMACIE :
    // non couvert (prisma/sql/067), part assurance 0 sans appel au microservice.
    if (garantiePharmacie && montantTotal.gt(0)) {
      let couvert: Decimal;
      try {
        const r = await this.adjudication.simuler({
          police_id: ordonnance.dossier.policeId,
          adherent_id: ordonnance.dossier.adherentId,
          beneficiaire_id: ordonnance.dossier.adherentId ? null : ordonnance.dossier.beneficiaireId,
          etablissement_id: null,
          date_reference: null,
          lignes: [
            {
              garantie_id: garantiePharmacie.id,
              montant: montantTotal.toFixed(2),
              code_acte: null,
              acte_dossier_id: null,
              date_soins: null,
            },
          ],
        });
        couvert = new Decimal(String(r.lignes[0].montant_couvert));
      } catch (err) {
        this.logger.error(
          `Calcul de la part assurance indisponible : ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new ServiceUnavailableException(
          MESSAGES_INDISPONIBILITE.dispensation,
        );
      }
      // Répartition de la part assurance au prorata des lignes (arrondi au
      // centime, reliquat sur la dernière) : chaque ligne garde sa part pour la
      // facture mensuelle de la pharmacie.
      let reste = couvert;
      detail.forEach((d, i) => {
        const part =
          i === detail.length - 1
            ? reste
            : couvert.mul(d.montantLigne).div(montantTotal).toDecimalPlaces(2);
        d.montantAssurance = part;
        d.montantPatient = d.montantLigne.sub(part);
        reste = reste.sub(part);
      });
    }

    const code = await this.genererCodeUnique();

    const dispensation = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispensationPharmacie.create({
        data: {
          ordonnanceId,
          pharmacieId,
          caissiereId: ctx.userId,
          montantTotal: montantTotal.toFixed(2),
          statut: 'EN_PREPARATION',
        },
      });
      await this.audit(tx, ctx.userId, 'PREPARATION_DISPENSATION', 'dispensations_pharmacie', d.id, {
        ordonnanceId,
        lignes: detail.map((x) => x.ligne.denominationMedicament),
        prix: detail.map((x) => ({
          medicament: x.ligne.denominationMedicament,
          prixUnitaire: x.prixUnitaire.toFixed(2),
          prixReference: x.prixReference ? x.prixReference.toFixed(2) : null,
          majorationPourcent: x.majorationPourcent ? x.majorationPourcent.toFixed(2) : null,
          majorationAnormale: x.majorationAnormale,
        })),
        seuilMajorationPourcent: seuil,
      });

      await tx.ligneDispensation.createMany({
        data: detail.map((x) => ({
          dispensationId: d.id,
          ligneOrdonnanceId: x.ligne.id,
          prixUnitaire: x.prixUnitaire.toFixed(2),
          quantite: x.quantite,
          montantLigne: x.montantLigne.toFixed(2),
          montantAssurance: x.montantAssurance.toFixed(2),
          montantPatient: x.montantPatient.toFixed(2),
          prixReference: x.prixReference ? x.prixReference.toFixed(2) : null,
          majorationPourcent: x.majorationPourcent ? x.majorationPourcent.toFixed(2) : null,
          majorationAnormale: x.majorationAnormale,
        })),
      });

      const mis = await tx.dispensationPharmacie.update({
        where: { id: d.id },
        data: { statut: 'EN_ATTENTE_VALIDATION_PATIENT', codeConfirmation: code },
      });
      await this.audit(tx, ctx.userId, 'GENERATION_CODE_DISPENSATION', 'dispensations_pharmacie', d.id, {
        montantTotal: montantTotal.toFixed(2),
      });
      return mis;
    });

    let envoi: { statut: string; detail: string } | null = null;
    if (canal && destinataire) {
      const pharmacie = await this.prisma.pharmacie.findUnique({ where: { id: pharmacieId }, select: { nom: true } });
      envoi = await this.notifications.envoyer(canal, destinataire, code, pharmacie?.nom ?? 'Pharmacie', 'Dispensation');
    }

    const montantAssuranceTotal = detail.reduce((acc, d) => acc.add(d.montantAssurance), new Decimal(0));
    const montantPatientTotal = detail.reduce((acc, d) => acc.add(d.montantPatient), new Decimal(0));

    // Réponse à LA PHARMACIE — jamais le code (envoyé à l'adhérent uniquement).
    return {
      dispensationId: dispensation.id,
      statut: dispensation.statut,
      montantTotal: dispensation.montantTotal.toFixed(2),
      montantAssurance: montantAssuranceTotal.toFixed(2),
      montantPatient: montantPatientTotal.toFixed(2),
      seuilMajorationPourcent: seuil,
      alertes: detail
        .filter((d) => d.majorationAnormale)
        .map((d) => ({
          medicament: d.ligne.denominationMedicament,
          prixUnitaire: d.prixUnitaire.toFixed(2),
          prixReference: d.prixReference!.toFixed(2),
          majorationPourcent: d.majorationPourcent!.toFixed(2),
        })),
      pharmacieCouverte: !!garantiePharmacie,
      envoi: envoi && canal ? { canal, statut: envoi.statut } : null,
      message:
        envoi && envoi.statut === 'ENVOYE'
          ? 'Dispensation préparée. Le code de confirmation a été envoyé au patient.'
          : 'Dispensation préparée. Le code de confirmation a été transmis au patient pour validation (visible dans son application).',
    };
  }

  /**
   * Détail d'une dispensation, côté PHARMACIE — scopé à SA pharmacie
   * uniquement (jamais celle d'une autre, même schéma que
   * `confirmerPaiementDispensation`). Permet à l'écran caissière/pharmacien
   * de suivre le statut (attente de validation patient → payable) et de
   * lister les lignes pour proposer une substitution. Le code de confirmation
   * n'est JAMAIS renvoyé ici (il ne part qu'au patient).
   */
  async obtenirDispensation(user: AuthenticatedUser, dispensationId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const dispensation = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.pharmacieId! },
      include: {
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
        reclamations: { select: { id: true, statut: true }, take: 1 },
      },
    });
    if (!dispensation) {
      throw new NotFoundException('Dispensation introuvable.');
    }

    const enLitige = await this.chargerLignesEnLitige(
      dispensation.lignes.map((l) => l.ligneOrdonnanceId),
    );
    const montantAssurance = dispensation.lignes.reduce(
      (acc, l) =>
        enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantAssurance.toString())),
      new Decimal(0),
    );
    const montantPatient = dispensation.lignes.reduce(
      (acc, l) =>
        enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantPatient.toString())),
      new Decimal(0),
    );

    return {
      id: dispensation.id,
      statut: dispensation.statut,
      montantTotal: dispensation.montantTotal.toFixed(2),
      montantAssurance: montantAssurance.toFixed(2),
      montantPatient: montantPatient.toFixed(2),
      datePreparation: dispensation.datePreparation,
      dateValidationPatient: dispensation.dateValidationPatient,
      datePaiement: dispensation.datePaiement,
      reclamation: dispensation.reclamations[0] ?? null,
      lignes: dispensation.lignes.map((l) => ({
        id: l.id,
        ligneOrdonnanceId: l.ligneOrdonnanceId,
        denominationMedicament: l.ligneOrdonnance.denominationMedicament,
        medicamentSubstitue: l.medicamentSubstitue,
        motifSubstitution: l.motifSubstitution,
        quantite: l.quantite,
        prixUnitaire: l.prixUnitaire.toFixed(2),
        prixReference: l.prixReference ? l.prixReference.toFixed(2) : null,
        majorationPourcent: l.majorationPourcent ? l.majorationPourcent.toFixed(2) : null,
        majorationAnormale: l.majorationAnormale,
        montantLigne: l.montantLigne.toFixed(2),
        enLitige: enLitige.has(l.ligneOrdonnanceId),
        montantAssurance: enLitige.has(l.ligneOrdonnanceId) ? null : l.montantAssurance.toFixed(2),
        montantPatient: enLitige.has(l.ligneOrdonnanceId) ? null : l.montantPatient.toFixed(2),
      })),
    };
  }

  /**
   * Liste des dispensations de SA pharmacie — corrige l'incohérence relevée
   * à l'audit : `pharmacien`/`comptable` lisaient encore l'ancien mécanisme
   * `codes_ordonnance` (PROMPT 19), qui ne reçoit plus d'écriture depuis que
   * la dispensation réelle passe par ce module. Filtre optionnel par statut
   * (le comptable ne veut que PAYEE). Le code de confirmation n'est JAMAIS
   * renvoyé ici (il ne part qu'au patient).
   */
  async listerDispensationsPharmacie(user: AuthenticatedUser, dto: ListerDispensationsQueryDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    // Pagination SERVEUR (remplace `take: 100` : l'historique au-delà était
    // inaccessible). Recherche sans accent pré-sélectionnée en SQL, puis
    // statut / période / pagination via Prisma ; total = résultats filtrés.
    const { page, limite, offset } = bornesPage(dto);
    const idsRecherche = dto.q?.trim()
      ? (
          await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT dp.id::text AS id
            FROM dispensations_pharmacie dp
            JOIN ordonnances o ON o.id = dp.ordonnance_id
            JOIN dossiers_soins d ON d.id = o.dossier_soins_id
            LEFT JOIN adherents ad ON ad.id = d.adherent_id
            LEFT JOIN beneficiaires b ON b.id = d.beneficiaire_id
            WHERE dp.pharmacie_id = ${ctx.pharmacieId!}::uuid
              AND ${conditionRecherche(dto.q, [
                Prisma.sql`ad.prenom`, Prisma.sql`ad.nom`, Prisma.sql`ad.numero_carte`,
                Prisma.sql`b.prenom`, Prisma.sql`b.nom`, Prisma.sql`b.numero_carte`,
                Prisma.sql`(SELECT string_agg(concat_ws(' ', lo.denomination_medicament, ld.medicament_substitue), ' ')
                            FROM lignes_dispensation ld JOIN lignes_ordonnance lo ON lo.id = ld.ligne_ordonnance_id
                            WHERE ld.dispensation_id = dp.id)`,
              ])}`
        ).map((r) => r.id)
      : null;
    const where: Prisma.DispensationPharmacieWhereInput = {
      pharmacieId: ctx.pharmacieId!,
      ...(dto.statut ? { statut: dto.statut } : {}),
      ...(filtrePeriode(dto.du, dto.au) ? { datePreparation: filtrePeriode(dto.du, dto.au) } : {}),
      ...(idsRecherche ? { id: { in: idsRecherche } } : {}),
    };
    const [total, dispensations] = await Promise.all([
      this.prisma.dispensationPharmacie.count({ where }),
      this.prisma.dispensationPharmacie.findMany({
      where,
      include: {
        ordonnance: {
          include: {
            dossier: {
              select: {
                adherent: { select: { nom: true, prenom: true, numeroCarte: true } },
                beneficiaire: { select: { nom: true, prenom: true, numeroCarte: true } },
              },
            },
          },
        },
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
      },
      orderBy: [{ datePreparation: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limite,
    }),
    ]);

    const enLitige = await this.chargerLignesEnLitige(
      dispensations.flatMap((d) => d.lignes.map((l) => l.ligneOrdonnanceId)),
    );

    const items = dispensations.map((d) => {
      const patient = d.ordonnance.dossier.adherent ?? d.ordonnance.dossier.beneficiaire;
      const montantAssurance = d.lignes.reduce(
        (acc, l) =>
          enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantAssurance.toString())),
        new Decimal(0),
      );
      const montantPatient = d.lignes.reduce(
        (acc, l) =>
          enLitige.has(l.ligneOrdonnanceId) ? acc : acc.add(new Decimal(l.montantPatient.toString())),
        new Decimal(0),
      );
      return {
        id: d.id,
        statut: d.statut,
        montantTotal: d.montantTotal.toFixed(2),
        montantAssurance: montantAssurance.toFixed(2),
        montantPatient: montantPatient.toFixed(2),
        datePreparation: d.datePreparation,
        dateValidationPatient: d.dateValidationPatient,
        datePaiement: d.datePaiement,
        patient: patient
          ? { nom: patient.nom, prenom: patient.prenom, numeroCarte: patient.numeroCarte }
          : null,
        lignes: d.lignes.map((l) => ({
          denominationMedicament: l.medicamentSubstitue ?? l.ligneOrdonnance.denominationMedicament,
          quantite: l.quantite,
          montantLigne: l.montantLigne.toFixed(2),
          enLitige: enLitige.has(l.ligneOrdonnanceId),
        })),
      };
    });
    return versPage(items, total, page, limite);
  }

  // --- Côté ADHÉRENT : ses dispensations en attente (avec le code) --

  async listerMesDispensations(user: AuthenticatedUser, dto: ListerMesDispensationsQueryDto = {}) {
    const ctx = await this.contexteAppelant(user);
    const { page, limite, offset } = bornesPage(dto);
    if (!ctx.adherentId) {
      return versPage([], 0, page, limite);
    }
    // Pagination SERVEUR (remplace `take: 50`) + statut + période de préparation.
    const where: Prisma.DispensationPharmacieWhereInput = {
      ordonnance: {
        dossier: {
          OR: [
            { adherentId: ctx.adherentId },
            { beneficiaire: { adherentId: ctx.adherentId } },
          ],
        },
      },
      ...(dto.statut ? { statut: dto.statut } : {}),
      ...(filtrePeriode(dto.du, dto.au) ? { datePreparation: filtrePeriode(dto.du, dto.au) } : {}),
    };
    const [total, dispensations] = await Promise.all([
      this.prisma.dispensationPharmacie.count({ where }),
      this.prisma.dispensationPharmacie.findMany({
        where,
        include: {
          pharmacie: { select: { nom: true } },
          lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
        },
        orderBy: [{ datePreparation: 'desc' }, { id: 'asc' }],
        skip: offset,
        take: limite,
      }),
    ]);
    const items = dispensations.map((d) => {
      const montantPatient = d.lignes.reduce(
        (acc, l) => acc.add(new Decimal(l.montantPatient.toString())),
        new Decimal(0),
      );
      const montantAssurance = d.lignes.reduce(
        (acc, l) => acc.add(new Decimal(l.montantAssurance.toString())),
        new Decimal(0),
      );
      return {
        id: d.id,
        pharmacie: d.pharmacie.nom,
        statut: d.statut,
        montantTotal: d.montantTotal.toFixed(2),
        montantAssurance: montantAssurance.toFixed(2),
        montantPatient: montantPatient.toFixed(2),
        code: d.statut === 'EN_ATTENTE_VALIDATION_PATIENT' ? d.codeConfirmation : undefined,
        medicaments: d.lignes.map((l) => l.ligneOrdonnance.denominationMedicament),
        datePreparation: d.datePreparation,
      };
    });
    return versPage(items, total, page, limite);
  }

  /**
   * Suppression (annulation) d'une facture d'ordonnance NON RÉGLÉE de SA pharmacie : passe à ANNULEE, le code
   * de confirmation devient inutilisable. Une dispensation PAYÉE est définitive (réclamation, facture mensuelle).
   * La ligne reste en base (traçabilité financière) et dans l'historique, au statut « Annulée ».
   */
  async annulerDispensation(user: AuthenticatedUser, dispensationId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);
    const d = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.pharmacieId! },
      select: { id: true, statut: true, montantTotal: true },
    });
    if (!d) throw new NotFoundException('Dispensation introuvable.');
    if (d.statut === 'PAYEE') throw new ConflictException('Cette facture est déjà réglée : elle ne peut plus être supprimée.');
    if (d.statut === 'ANNULEE') throw new ConflictException('Cette facture est déjà supprimée.');
    const { count } = await this.prisma.dispensationPharmacie.updateMany({
      where: { id: d.id, statut: { in: ['EN_PREPARATION', 'EN_ATTENTE_VALIDATION_PATIENT', 'VALIDEE'] } },
      data: { statut: 'ANNULEE' },
    });
    if (count === 0) throw new ConflictException('Le statut de cette facture a changé : actualisez la page.');
    await this.audit(this.prisma, ctx.userId, 'ANNULATION_DISPENSATION', 'dispensations_pharmacie', d.id, {
      statutPrecedent: d.statut,
      montantTotal: d.montantTotal.toString(),
    });
    return { id: d.id, statut: 'ANNULEE' as const };
  }

  /** Validation du code par l'ADHÉRENT — passe à VALIDEE, PAS encore PAYEE. */
  async validerCodeDispensation(user: AuthenticatedUser, dto: ValiderCodeDispensationDto) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.some((r) => (ROLES_ADHERENT as readonly string[]).includes(r))) {
      throw new ForbiddenException('Seul un adhérent peut valider un code de dispensation.');
    }
    if (!ctx.adherentId) {
      throw new ForbiddenException("Votre compte n'est rattaché à aucun adhérent.");
    }

    const dispensation = await this.prisma.dispensationPharmacie.findUnique({
      where: { codeConfirmation: dto.code.toUpperCase() },
      include: { ordonnance: { include: { dossier: { include: { beneficiaire: true } } } } },
    });
    if (!dispensation) {
      throw new NotFoundException('Code de dispensation invalide.');
    }
    const dossier = dispensation.ordonnance.dossier;
    const estLePatient =
      dossier.adherentId === ctx.adherentId ||
      (dossier.beneficiaire && dossier.beneficiaire.adherentId === ctx.adherentId);
    if (!estLePatient) {
      throw new ForbiddenException('Cette dispensation ne vous concerne pas.');
    }
    if (dispensation.statut !== 'EN_ATTENTE_VALIDATION_PATIENT') {
      throw new ConflictException(
        `Ce code ne peut plus être validé (statut actuel : ${dispensation.statut}).`,
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const d = await tx.dispensationPharmacie.update({
        where: { id: dispensation.id },
        data: { statut: 'VALIDEE', dateValidationPatient: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_CODE_DISPENSATION', 'dispensations_pharmacie', d.id, null);
      return d;
    });

    return { dispensationId: maj.id, statut: maj.statut };
  }

  /**
   * Validation du code PAR LA PHARMACIE : le patient lui communique le code reçu ; il doit correspondre à celui de
   * la dispensation (de SA pharmacie, en attente de validation). Même effet que la validation dans l'application
   * du patient : statut VALIDEE, paiement ensuite possible.
   */
  async validerCodeParPharmacie(user: AuthenticatedUser, dispensationId: string, code: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);
    const d = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.pharmacieId! },
      select: { id: true, statut: true, codeConfirmation: true },
    });
    if (!d) throw new NotFoundException('Dispensation introuvable.');
    if (d.statut !== 'EN_ATTENTE_VALIDATION_PATIENT') {
      throw new ConflictException(`Ce code ne peut plus être validé (statut actuel : ${d.statut}).`);
    }
    if (!d.codeConfirmation || d.codeConfirmation !== code.trim().toUpperCase()) {
      await this.audit(this.prisma, ctx.userId, 'CODE_DISPENSATION_INCORRECT', 'dispensations_pharmacie', d.id, null);
      throw new ForbiddenException('Code incorrect : demandez au patient de vérifier le code qu’il a reçu.');
    }
    const maj = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.dispensationPharmacie.updateMany({
        where: { id: d.id, statut: 'EN_ATTENTE_VALIDATION_PATIENT' },
        data: { statut: 'VALIDEE', dateValidationPatient: new Date() },
      });
      if (count === 0) throw new ConflictException('Le statut de cette dispensation a changé : actualisez la page.');
      await this.audit(tx, ctx.userId, 'VALIDATION_CODE_DISPENSATION_PAR_PHARMACIE', 'dispensations_pharmacie', d.id, null);
      return { dispensationId: d.id, statut: 'VALIDEE' as const };
    });
    return maj;
  }

  /**
   * Confirmation du paiement — réservée à la pharmacie propriétaire de la
   * dispensation.
   *
   * GARDE BLOQUANTE EXPLICITE : refuse absolument si le statut n'est pas
   * VALIDEE — même principe que `confirmerPaiement` (factures établissement,
   * v8 §5). Doublée par le trigger `verifier_dispensation_payable()`.
   * Verrouille chaque ligne concernée (compare-and-swap : DISPONIBLE ->
   * SERVIE) — si une ligne a été prise entre-temps par une autre pharmacie,
   * la transaction entière échoue plutôt que de facturer une ligne déjà
   * servie ailleurs.
   *
   * Le patient ne règle QUE `montantPatient` (jamais le total) : dès le
   * paiement enregistré, une réclamation est soumise au microservice
   * d'adjudication pour `montantAssurance` — « une dispensation payée = un
   * remboursement réclamé », jamais un flux séparé sans lien avec
   * l'adjudication. Le paiement lui-même reste acquis même si l'appel
   * d'adjudication échoue (le patient a déjà réglé) : l'erreur remonte
   * explicitement (502/503, même contrat que `ClaimsService.soumettre`) pour
   * qu'une nouvelle tentative de soumission soit possible — la réclamation
   * reste idempotente sur `dispensationId`.
   */
  async confirmerPaiementDispensation(user: AuthenticatedUser, dispensationId: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertPharmacie(ctx);

    const dispensation = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.pharmacieId! },
      include: {
        lignes: true,
        ordonnance: {
          include: {
            dossier: {
              select: {
                id: true,
                adherentId: true,
                beneficiaireId: true,
                policeId: true,
                police: { select: { produitId: true } },
              },
            },
          },
        },
      },
    });
    if (!dispensation) {
      throw new NotFoundException('Dispensation introuvable.');
    }

    // >>> GARDE ANTI-FRAUDE — NE JAMAIS RETIRER <<<
    if (dispensation.statut !== 'VALIDEE') {
      throw new ForbiddenException(
        dispensation.statut === 'PAYEE'
          ? 'Cette dispensation a déjà été payée.'
          : "Règlement impossible : le code de confirmation n'a pas encore été validé par le patient.",
      );
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      for (const ligne of dispensation.lignes) {
        const { count } = await tx.ligneOrdonnance.updateMany({
          where: { id: ligne.ligneOrdonnanceId, statut: 'DISPONIBLE' },
          data: {
            statut: 'SERVIE',
            pharmacieServanteId: ctx.pharmacieId!,
            quantiteServie: ligne.quantite,
          },
        });
        if (count === 0) {
          throw new ConflictException(
            "Une des lignes de cette dispensation a déjà été servie par une autre pharmacie entre-temps — paiement annulé, réessayez.",
          );
        }
      }
      const d = await tx.dispensationPharmacie.update({
        where: { id: dispensationId },
        data: { statut: 'PAYEE', datePaiement: new Date() },
      });
      await this.audit(tx, ctx.userId, 'CONFIRMATION_PAIEMENT_DISPENSATION', 'dispensations_pharmacie', d.id, {
        montantTotal: d.montantTotal.toFixed(2),
      });
      return d;
    });

    const montantAssurance = dispensation.lignes.reduce(
      (acc, l) => acc.add(new Decimal(l.montantAssurance.toString())),
      new Decimal(0),
    );
    const montantPatient = dispensation.lignes.reduce(
      (acc, l) => acc.add(new Decimal(l.montantPatient.toString())),
      new Decimal(0),
    );

    const dossier = dispensation.ordonnance.dossier;
    const garantiePharmacie = await this.prisma.garantie.findFirst({
      where: {
        produitId: dossier.police.produitId,
        categorieActe: CATEGORIE_ACTE_PHARMACIE,
        deletedAt: null,
      },
    });

    let reclamation: { id: string; statut: string } | null = null;
    if (garantiePharmacie && montantAssurance.gt(0)) {
      const resultat = await this.claims
        .soumettreDepuisDispensation(
        { userId: ctx.userId, organisationId: ctx.organisationId },
        {
          dispensationId: maj.id,
          dossierSoinsId: dossier.id,
          adherentId: dossier.adherentId,
          beneficiaireId: dossier.beneficiaireId,
          policeId: dossier.policeId,
          garantieId: garantiePharmacie.id,
          // Montant BRUT réclamé (total de la dispensation), comme pour une
          // réclamation d'acte : c'est le microservice qui applique franchise,
          // taux, plafond par acte et plafond annuel. Envoyer la part assurance
          // (déjà multipliée par le taux) faisait appliquer le taux deux fois.
          montant: maj.montantTotal.toFixed(2),
        },
      )
        .catch((err: unknown) => {
          // Paiement acquis, réclamation laissée SOUMISE (reprise par l'assureur) :
          // le pharmacien n'a rien à refaire — message dédié, sans détail technique.
          if (
            err instanceof ServiceUnavailableException ||
            err instanceof BadGatewayException
          ) {
            throw new ServiceUnavailableException(
              MESSAGES_INDISPONIBILITE.paiementDispensation,
            );
          }
          throw err;
        });
      reclamation = {
        id: resultat.reclamation.id,
        statut: resultat.reclamation.statut,
      };
    }

    return {
      dispensationId: maj.id,
      statut: maj.statut,
      montantTotal: maj.montantTotal.toFixed(2),
      montantAssurance: montantAssurance.toFixed(2),
      montantPatient: montantPatient.toFixed(2),
      datePaiement: maj.datePaiement,
      reclamation,
    };
  }

  // --- Substitution de médicament (PHARMACIE_PHARMACIEN + ASSUREUR_PHARMACIEN_CONSEIL) --

  /**
   * Remplace/ajuste le médicament d'une ligne de dispensation — réservé au
   * PHARMACIEN de la pharmacie concernée (jamais la caissière ni le
   * comptable, clarification métier : "concernant la modification ou la
   * substitution d'un médicament le pharmacien doit valider") **ou** à
   * ASSUREUR_PHARMACIEN_CONSEIL (capacité ADDITIVE, organisation entière —
   * ex. correction a posteriori lors d'une revue de contestation). L'audit
   * distingue les deux acteurs (`SUBSTITUTION_PHARMACIEN` vs
   * `SUBSTITUTION_PHARMACIEN_CONSEIL`). Ne s'applique QUE tant que le
   * paiement n'a pas été confirmé (EN_PREPARATION ou
   * EN_ATTENTE_VALIDATION_PATIENT) — une fois VALIDEE par le patient (il a vu
   * le total correspondant) ou PAYEE, le contenu ne peut plus changer en
   * silence, quel que soit l'acteur.
   */
  async substituerMedicament(
    user: AuthenticatedUser,
    ligneDispensationId: string,
    dto: SubstituerMedicamentDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    const acteur = this.assertPeutSubstituer(ctx);

    const ligne = await this.prisma.ligneDispensation.findFirst({
      where: {
        id: ligneDispensationId,
        dispensation:
          acteur === 'PHARMACIEN_CONSEIL'
            ? { pharmacie: { organisationId: ctx.organisationId } }
            : { pharmacieId: ctx.pharmacieId! },
      },
      include: { dispensation: true, ligneOrdonnance: true },
    });
    if (!ligne) {
      throw new NotFoundException('Ligne de dispensation introuvable.');
    }
    if (!(STATUTS_DISPENSATION_MODIFIABLE as readonly string[]).includes(ligne.dispensation.statut)) {
      throw new ConflictException(
        `Substitution impossible : cette dispensation est déjà ${ligne.dispensation.statut} — le paiement ne peut plus être modifié en silence.`,
      );
    }

    // le médicament de remplacement est CHOISI dans la base (catalogue activé par l'assureur) : pas de saisie libre
    const remplacement = await this.medicamentRemboursable(ctx.organisationId, dto.nouveauMedicamentId);
    const nouveauMedicament = this.libelleMedicament(remplacement);

    const action = acteur === 'PHARMACIEN_CONSEIL' ? 'SUBSTITUTION_PHARMACIEN_CONSEIL' : 'SUBSTITUTION_PHARMACIEN';
    const maj = await this.prisma.$transaction(async (tx) => {
      const l = await tx.ligneDispensation.update({
        where: { id: ligneDispensationId },
        data: {
          medicamentSubstitue: nouveauMedicament,
          motifSubstitution: dto.motif,
          substitueParId: ctx.userId,
          dateSubstitution: new Date(),
        },
      });
      await this.audit(tx, ctx.userId, action, 'lignes_dispensation', l.id, {
        dispensationId: ligne.dispensationId,
        medicamentOriginal: ligne.ligneOrdonnance.denominationMedicament,
        nouveauMedicament,
        nouveauMedicamentId: dto.nouveauMedicamentId,
        motif: dto.motif,
      });
      return l;
    });

    return {
      ligneDispensationId: maj.id,
      medicamentOriginal: ligne.ligneOrdonnance.denominationMedicament,
      medicamentSubstitue: maj.medicamentSubstitue,
      motif: maj.motifSubstitution,
      dateSubstitution: maj.dateSubstitution,
    };
  }

  // =====================================================================
  //  Consolidation mensuelle des factures pharmacie — circuit à 3 niveaux :
  //  PHARMACIE soumet → ASSUREUR_PHARMACIEN_CONSEIL valide (double
  //  vérification anti-litige) → ASSUREUR_COMPTABLE programme puis marque
  //  payée. `montantTotal` = somme des `montantAssurance` (ce que l'assureur
  //  doit à la pharmacie — le patient a déjà réglé `montantPatient` au
  //  comptoir), jamais `montantLigne` ni `montantPatient`.
  // =====================================================================

  /**
   * Bornes [début, fin[ du mois PRÉCÉDANT le mois en cours, en UTC (ce
   * système n'a pas de fuseau horaire à gérer — Abidjan = UTC toute l'année).
   */
  private bornesMoisPrecedent(maintenant: Date): { debut: Date; fin: Date } {
    const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 1));
    const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
    return { debut, fin };
  }

  /**
   * Soumet la consolidation du mois précédent — réservé à PHARMACIE_PHARMACIEN/
   * PHARMACIE_COMPTABLE (jamais la caissière), toujours pour SA pharmacie
   * (jamais un `pharmacieId` fourni par le client). `periode` doit être
   * exactement le 1er jour du mois précédent — pas de rattrapage de mois plus
   * anciens ni de mois en cours (déclenchable seulement à partir du 1er).
   * Agrège les `LigneDispensation` des dispensations PAYEE de la période,
   * jamais déjà réclamées par une facture antérieure
   * (`factureMensuelleId is null`), et EXCLUT toute ligne actuellement en
   * litige (`ContestationPrescription` OUVERT/JUSTIFICATION_RECUE/REJETEE) —
   * ces lignes ne sont pas stampées, elles restent donc éligibles à une
   * consolidation future une fois la contestation VALIDEE.
   */
  async soumettreFactureMensuelle(user: AuthenticatedUser, dto: SoumettreFactureMensuelleDto) {
    const ctx = await this.contexteAppelant(user);
    if (
      !ctx.roleChain.some((r) => (ROLES_FACTURATION_MENSUELLE as readonly string[]).includes(r)) ||
      !ctx.pharmacieId
    ) {
      throw new ForbiddenException(
        'Réservé au pharmacien ou au comptable de la pharmacie concernée.',
      );
    }
    await this.assertPharmacieNonArchivee(ctx.pharmacieId, 'aucune nouvelle facture mensuelle');

    const maintenant = new Date();
    const { debut, fin } = this.bornesMoisPrecedent(maintenant);
    const periodeDemandee = new Date(`${dto.periode}T00:00:00.000Z`);
    if (
      periodeDemandee.getUTCFullYear() !== debut.getUTCFullYear() ||
      periodeDemandee.getUTCMonth() !== debut.getUTCMonth()
    ) {
      throw new BadRequestException(
        `Seule la consolidation du mois précédent est possible actuellement (${debut.toISOString().slice(0, 7)}-01).`,
      );
    }

    const existante = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { pharmacieId: ctx.pharmacieId, periode: debut },
    });
    if (existante && existante.statut !== 'EN_PREPARATION') {
      throw new ConflictException(
        `Une facture existe déjà pour cette période (statut : ${existante.statut}).`,
      );
    }

    // OR reportee_mois_suivant : une ligne exclue pour litige lors d'une
    // consolidation antérieure (soumission ou `decocherLigneContestee`) reste
    // candidate indéfiniment, quel que soit son `datePaiement` d'origine —
    // seul son statut de litige ACTUEL décide de sa réintégration.
    const toutesLignes = await this.prisma.ligneDispensation.findMany({
      where: {
        factureMensuelleId: null,
        dispensation: { pharmacieId: ctx.pharmacieId, statut: 'PAYEE' },
        OR: [
          { dispensation: { datePaiement: { gte: debut, lt: fin } } },
          { reporteeMoisSuivant: true },
        ],
      },
      select: { id: true, ligneOrdonnanceId: true, montantAssurance: true },
    });
    const enLitige = await this.chargerLignesEnLitige(toutesLignes.map((l) => l.ligneOrdonnanceId));
    const lignesFacturables = toutesLignes.filter((l) => !enLitige.has(l.ligneOrdonnanceId));
    const lignesEncoreEnLitige = toutesLignes.filter((l) => enLitige.has(l.ligneOrdonnanceId));
    const montantTotal = lignesFacturables.reduce(
      (acc, l) => acc.add(new Decimal(l.montantAssurance.toString())),
      new Decimal(0),
    );

    const facture = await this.prisma.$transaction(async (tx) => {
      const f = existante
        ? await tx.factureMensuellePharmacie.update({
            where: { id: existante.id },
            data: { montantTotal: montantTotal.toFixed(2) },
          })
        : await tx.factureMensuellePharmacie.create({
            data: {
              organisationId: ctx.organisationId,
              pharmacieId: ctx.pharmacieId!,
              periode: debut,
              montantTotal: montantTotal.toFixed(2),
            },
          });
      if (lignesFacturables.length > 0) {
        await tx.ligneDispensation.updateMany({
          where: { id: { in: lignesFacturables.map((l) => l.id) } },
          data: { factureMensuelleId: f.id, reporteeMoisSuivant: false },
        });
      }
      if (lignesEncoreEnLitige.length > 0) {
        await tx.ligneDispensation.updateMany({
          where: { id: { in: lignesEncoreEnLitige.map((l) => l.id) } },
          data: { reporteeMoisSuivant: true },
        });
      }
      const soumise = await tx.factureMensuellePharmacie.update({
        where: { id: f.id },
        data: { statut: 'SOUMISE', dateSoumission: new Date() },
      });
      await this.audit(tx, ctx.userId, 'SOUMISSION_FACTURE_MENSUELLE', 'factures_mensuelles_pharmacie', f.id, {
        periode: dto.periode,
        montantTotal: montantTotal.toFixed(2),
        nbLignesIncluses: lignesFacturables.length,
        nbLignesExclues: toutesLignes.length - lignesFacturables.length,
      });
      return soumise;
    });

    return {
      id: facture.id,
      periode: facture.periode,
      statut: facture.statut,
      montantTotal: facture.montantTotal.toFixed(2),
      dateSoumission: facture.dateSoumission,
      nbLignesIncluses: lignesFacturables.length,
      nbLignesExclues: toutesLignes.length - lignesFacturables.length,
    };
  }

  /** Détail ligne-par-ligne d'une facture mensuelle — le verrou d'accès de
   * ASSUREUR_COMPTABLE (statut ≥ VALIDEE_PHARMACIEN_CONSEIL) est vérifié
   * explicitement ici, pas seulement par le filtre des listes : un accès
   * direct par id doit être refusé de la même façon. */
  async obtenirFactureMensuelle(user: AuthenticatedUser, factureMensuelleId: string) {
    const ctx = await this.contexteAppelant(user);
    const facture = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { id: factureMensuelleId, organisationId: ctx.organisationId },
      include: {
        pharmacie: { select: { nom: true } },
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } } },
      },
    });
    if (!facture) {
      throw new NotFoundException('Facture mensuelle introuvable.');
    }

    const estPharmacieConcernee = ctx.pharmacieId && ctx.pharmacieId === facture.pharmacieId;
    const estPharmacienConseil = ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL);
    const estComptable = ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE);
    if (!estPharmacieConcernee && !estPharmacienConseil && !estComptable) {
      throw new ForbiddenException("Vous n'avez pas accès à cette facture mensuelle.");
    }

    const enLitige = await this.chargerLignesEnLitige(facture.lignes.map((l) => l.ligneOrdonnanceId));

    return {
      id: facture.id,
      pharmacie: facture.pharmacie.nom,
      periode: facture.periode,
      statut: facture.statut,
      montantTotal: facture.montantTotal.toFixed(2),
      nbLignesReportees: facture.nbLignesReportees,
      dateSoumission: facture.dateSoumission,
      dateValidation: facture.dateValidation,
      dateProgrammation: facture.dateProgrammation,
      datePaiement: facture.datePaiement,
      lignes: facture.lignes.map((l) => ({
        id: l.id,
        ligneOrdonnanceId: l.ligneOrdonnanceId,
        denominationMedicament: l.medicamentSubstitue ?? l.ligneOrdonnance.denominationMedicament,
        quantite: l.quantite,
        montantAssurance: l.montantAssurance.toFixed(2),
        prixUnitaire: l.prixUnitaire.toFixed(2),
        prixReference: l.prixReference ? l.prixReference.toFixed(2) : null,
        majorationPourcent: l.majorationPourcent ? l.majorationPourcent.toFixed(2) : null,
        majorationAnormale: l.majorationAnormale,
        enLitige: enLitige.has(l.ligneOrdonnanceId),
      })),
    };
  }

  /** Côté PHARMACIE : historique de SES factures mensuelles, tout statut. */
  async listerMesFacturesMensuelles(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.pharmacieId) {
      throw new ForbiddenException("Réservé au personnel d'une pharmacie du réseau.");
    }
    const factures = await this.prisma.factureMensuellePharmacie.findMany({
      where: { pharmacieId: ctx.pharmacieId },
      orderBy: { periode: 'desc' },
    });
    return factures.map((f) => ({
      id: f.id,
      periode: f.periode,
      statut: f.statut,
      montantTotal: f.montantTotal.toFixed(2),
      dateSoumission: f.dateSoumission,
      dateValidation: f.dateValidation,
      datePaiement: f.datePaiement,
    }));
  }

  /** Côté PHARMACIEN CONSEIL : « Factures mensuelles à valider » (SOUMISE, organisation entière). */
  async listerFacturesMensuellesAValider(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_PHARMACIEN_CONSEIL.');
    }
    const factures = await this.prisma.factureMensuellePharmacie.findMany({
      where: { organisationId: ctx.organisationId, statut: 'SOUMISE' },
      include: { pharmacie: { select: { nom: true } } },
      orderBy: { dateSoumission: 'asc' },
    });
    return factures.map((f) => ({
      id: f.id,
      pharmacie: f.pharmacie.nom,
      periode: f.periode,
      statut: f.statut,
      montantTotal: f.montantTotal.toFixed(2),
      dateSoumission: f.dateSoumission,
    }));
  }

  /**
   * Tranche la validation — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL.
   * Double sécurité explicite : ne fait AUCUNE confiance à l'agrégation faite
   * à la soumission — recharge les lignes stampées par CETTE facture et
   * revérifie leur statut de litige à l'instant présent (une contestation a
   * pu être ouverte APRÈS la soumission, AVANT la validation).
   */
  async validerFactureMensuelle(
    user: AuthenticatedUser,
    factureMensuelleId: string,
    dto: ValiderFactureMensuelleDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_PHARMACIEN_CONSEIL.');
    }

    const facture = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { id: factureMensuelleId, organisationId: ctx.organisationId },
      include: { lignes: { select: { ligneOrdonnanceId: true } } },
    });
    if (!facture) {
      throw new NotFoundException('Facture mensuelle introuvable.');
    }
    if (facture.statut !== 'SOUMISE') {
      throw new ConflictException(
        `Cette facture n'est pas en attente de validation (statut actuel : ${facture.statut}).`,
      );
    }

    const enLitige = await this.chargerLignesEnLitige(facture.lignes.map((l) => l.ligneOrdonnanceId));
    if (enLitige.size > 0) {
      throw new ConflictException({
        message: `Validation impossible : ${enLitige.size} ligne(s) déjà incluse(s) sont désormais en litige (contestation ouverte après la soumission) — à régler avant de revalider.`,
        ligneOrdonnanceIdsEnLitige: [...enLitige],
      });
    }

    if (dto.decision === 'A_CORRIGER') {
      const maj = await this.prisma.$transaction(async (tx) => {
        await tx.ligneDispensation.updateMany({
          where: { factureMensuelleId: facture.id },
          data: { factureMensuelleId: null },
        });
        const f = await tx.factureMensuellePharmacie.update({
          where: { id: facture.id },
          data: { statut: 'EN_PREPARATION', dateSoumission: null },
        });
        await this.audit(
          tx,
          ctx.userId,
          'FACTURE_MENSUELLE_PHARMACIE_A_CORRIGER',
          'factures_mensuelles_pharmacie',
          f.id,
          { nbLignesLiberees: facture.lignes.length },
        );
        return f;
      });
      return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
    }

    const maj = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureMensuellePharmacie.update({
        where: { id: factureMensuelleId },
        data: { statut: 'VALIDEE_PHARMACIEN_CONSEIL', valideParId: ctx.userId, dateValidation: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_FACTURE_MENSUELLE', 'factures_mensuelles_pharmacie', f.id, {
        montantTotal: f.montantTotal.toFixed(2),
      });
      return f;
    });

    return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
  }

  /** Côté COMPTABLE : « Factures pharmacie » — TOUT statut, organisation
   * entière (accès en revue global). Le tri par catégorie (du mois, en
   * paiement, réglées…) reste un filtrage côté écran. */
  async listerFacturesMensuellesPourComptable(user: AuthenticatedUser) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
    }
    const factures = await this.prisma.factureMensuellePharmacie.findMany({
      where: { organisationId: ctx.organisationId },
      include: { pharmacie: { select: { nom: true } } },
      orderBy: { periode: 'desc' },
    });
    return factures.map((f) => ({
      id: f.id,
      pharmacie: f.pharmacie.nom,
      periode: f.periode,
      statut: f.statut,
      montantTotal: f.montantTotal.toFixed(2),
      nbLignesReportees: f.nbLignesReportees,
      dateSoumission: f.dateSoumission,
      dateValidation: f.dateValidation,
      dateProgrammation: f.dateProgrammation,
      datePaiement: f.datePaiement,
    }));
  }

  private async chargerFacturePourComptable(ctx: ContexteAppelant, factureMensuelleId: string) {
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
    }
    const facture = await this.prisma.factureMensuellePharmacie.findFirst({
      where: { id: factureMensuelleId, organisationId: ctx.organisationId },
      include: { lignes: { select: { id: true, ligneOrdonnanceId: true, montantAssurance: true } } },
    });
    if (!facture) {
      throw new NotFoundException('Facture mensuelle introuvable.');
    }
    return facture;
  }

  /**
   * Retire manuellement une ligne encore EN LITIGE d'une facture — réservé
   * EXCLUSIVEMENT à ASSUREUR_COMPTABLE, applicable tant que la facture n'a pas
   * dépassé la validation du pharmacien conseil (SOUMISE ou
   * VALIDEE_PHARMACIEN_CONSEIL). Marquée `reporteeMoisSuivant` — réintégrée
   * automatiquement dès que le litige associé n'est plus actif (VALIDEE), ou
   * jamais si REJETEE.
   */
  async decocherLigneContestee(user: AuthenticatedUser, factureMensuelleId: string, ligneId: string) {
    const ctx = await this.contexteAppelant(user);
    if (!ctx.roleChain.includes(ROLE_COMPTABLE_FACTURE_MENSUELLE)) {
      throw new ForbiddenException('Réservé exclusivement à ASSUREUR_COMPTABLE.');
    }
    const facture = await this.chargerFacturePourComptable(ctx, factureMensuelleId);
    if (!['SOUMISE', 'VALIDEE_PHARMACIEN_CONSEIL'].includes(facture.statut)) {
      throw new ConflictException(
        `Impossible de retirer une ligne : cette facture est déjà ${facture.statut}.`,
      );
    }
    const ligne = facture.lignes.find((l) => l.id === ligneId);
    if (!ligne) {
      throw new NotFoundException("Cette ligne n'appartient pas à cette facture.");
    }
    const enLitige = await this.chargerLignesEnLitige([ligne.ligneOrdonnanceId]);
    if (!enLitige.has(ligne.ligneOrdonnanceId)) {
      throw new BadRequestException("Cette ligne n'est pas en litige — rien à retirer.");
    }

    const montantTotal = new Decimal(facture.montantTotal.toString()).sub(
      new Decimal(ligne.montantAssurance.toString()),
    );

    const maj = await this.prisma.$transaction(async (tx) => {
      await tx.ligneDispensation.update({
        where: { id: ligne.id },
        data: { factureMensuelleId: null, reporteeMoisSuivant: true },
      });
      const f = await tx.factureMensuellePharmacie.update({
        where: { id: facture.id },
        data: { montantTotal: montantTotal.toFixed(2), nbLignesReportees: { increment: 1 } },
      });
      await this.audit(
        tx,
        ctx.userId,
        'DECOCHAGE_LIGNE_CONTESTEE_FACTURE_MENSUELLE',
        'factures_mensuelles_pharmacie',
        f.id,
        { ligneId: ligne.id, ligneOrdonnanceId: ligne.ligneOrdonnanceId, montantAssurance: ligne.montantAssurance.toFixed(2) },
      );
      return f;
    });

    return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
  }

  /**
   * Valide une facture pour paiement — réservé EXCLUSIVEMENT à
   * ASSUREUR_COMPTABLE, uniquement si AUCUNE ligne en litige non décochée ne
   * subsiste. VALIDEE_PHARMACIEN_CONSEIL → PROGRAMMEE_PAIEMENT.
   */
  async validerPourPaiement(user: AuthenticatedUser, factureMensuelleId: string) {
    const ctx = await this.contexteAppelant(user);
    const facture = await this.chargerFacturePourComptable(ctx, factureMensuelleId);
    if (facture.statut !== 'VALIDEE_PHARMACIEN_CONSEIL') {
      throw new ConflictException(
        `Cette facture est déjà ${facture.statut} — la validation pour paiement ne s'applique qu'après validation du pharmacien conseil.`,
      );
    }
    const enLitige = await this.chargerLignesEnLitige(facture.lignes.map((l) => l.ligneOrdonnanceId));
    if (enLitige.size > 0) {
      throw new ConflictException({
        message: `${enLitige.size} ligne(s) de cette facture sont encore en litige — décochez-les (decocherLigneContestee) avant de valider pour paiement.`,
        ligneOrdonnanceIdsEnLitige: [...enLitige],
      });
    }
    const maj = await this.prisma.$transaction(async (tx) => {
      const f = await tx.factureMensuellePharmacie.update({
        where: { id: factureMensuelleId },
        data: { statut: 'PROGRAMMEE_PAIEMENT', dateProgrammation: new Date() },
      });
      await this.audit(tx, ctx.userId, 'VALIDATION_PAIEMENT_FACTURE_MENSUELLE', 'factures_mensuelles_pharmacie', f.id, {});
      return f;
    });
    return { ...maj, montantTotal: maj.montantTotal.toFixed(2) };
  }

  // Le paiement RÉEL (débit d'un compte financier) est désormais réservé à
  // `PaymentService.payerFacture` (module payment/) — l'ancien
  // `marquerFactureMensuellePayee` (symbolique) a été retiré.

  // --- Helpers -------------------------------------------------------

  private async contexteAppelant(user: AuthenticatedUser): Promise<ContexteAppelant> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return {
      userId: profil.id,
      organisationId: profil.organisationId,
      role: profil.role,
      roleChain: permissions?.roleChain ?? [],
      pharmacieId: profil.pharmacieId,
      adherentId: profil.adherentId,
    };
  }

  /** Pharmacie archivée (RESILIEE) : plus de nouvelle dispensation ni facturation (ADR-007, lot 3). */
  private async assertPharmacieNonArchivee(pharmacieId: string, quoi: string): Promise<void> {
    const p = await this.prisma.pharmacie.findUnique({
      where: { id: pharmacieId },
      select: { nom: true, statut: true, deletedAt: true },
    });
    if (!p || p.deletedAt || p.statut === 'RESILIEE') {
      throw new ConflictException(
        `La pharmacie « ${p?.nom ?? 'inconnue'} » est archivée : ${quoi}. L'historique reste consultable.`,
      );
    }
  }

  private assertPharmacie(ctx: ContexteAppelant): void {
    const estPharmacie = ctx.roleChain.some((r) => (ROLES_PHARMACIE as readonly string[]).includes(r));
    if (!estPharmacie || !ctx.pharmacieId) {
      throw new ForbiddenException("Réservé au personnel d'une pharmacie du réseau.");
    }
  }

  private assertPharmacien(ctx: ContexteAppelant): void {
    if (!ctx.roleChain.includes(ROLE_PHARMACIEN_SEUL) || !ctx.pharmacieId) {
      throw new ForbiddenException('Réservé au pharmacien titulaire de la pharmacie.');
    }
  }

  /**
   * Substitution — capacité ADDITIVE : le pharmacien titulaire de SA pharmacie
   * (comme partout ailleurs dans ce module), OU ASSUREUR_PHARMACIEN_CONSEIL
   * (organisation entière, jamais scopé à une pharmacie précise). Ni la
   * caissière ni le comptable pharmacie, ni aucun autre rôle ASSUREUR.
   */
  private assertPeutSubstituer(ctx: ContexteAppelant): 'PHARMACIEN' | 'PHARMACIEN_CONSEIL' {
    if (ctx.roleChain.includes(ROLE_PHARMACIEN_CONSEIL)) {
      return 'PHARMACIEN_CONSEIL';
    }
    if (ctx.roleChain.includes(ROLE_PHARMACIEN_SEUL) && ctx.pharmacieId) {
      return 'PHARMACIEN';
    }
    throw new ForbiddenException(
      'Réservé au pharmacien titulaire de la pharmacie ou au pharmacien conseil.',
    );
  }

  /**
   * Lignes actuellement EN LITIGE (contestation OUVERT/JUSTIFICATION_RECUE =
   * temporaire, ou REJETEE = définitif — module `contestation/`) — exclues de
   * tout calcul de montant facturable, `enLitige: true` renvoyé à la place
   * partout où le montant de la ligne apparaît. Seul VALIDEE débloque.
   */
  private async chargerLignesEnLitige(ligneOrdonnanceIds: string[]): Promise<Set<string>> {
    if (ligneOrdonnanceIds.length === 0) {
      return new Set();
    }
    const contestations = await this.prisma.contestationPrescription.findMany({
      where: {
        ligneOrdonnanceId: { in: ligneOrdonnanceIds },
        statut: { in: STATUTS_CONTESTATION_EN_LITIGE as unknown as string[] },
      },
      select: { ligneOrdonnanceId: true },
    });
    return new Set(contestations.map((c) => c.ligneOrdonnanceId));
  }

  private async genererCodeUnique(): Promise<string> {
    for (let tentative = 0; tentative < 6; tentative += 1) {
      let candidat = '';
      for (let i = 0; i < LONGUEUR_CODE; i += 1) {
        candidat += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)];
      }
      const existe = await this.prisma.dispensationPharmacie.findUnique({
        where: { codeConfirmation: candidat },
      });
      if (!existe) {
        return candidat;
      }
    }
    throw new ConflictException("Impossible de générer un code unique — réessayez.");
  }

  private async audit(
    db: Db,
    userId: string,
    action: string,
    table: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${table}::text,
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
