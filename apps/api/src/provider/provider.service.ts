import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEtablissementDto,
  CreatePharmacieDto,
  CreateTarifConventionneDto,
  EnregistrerVerificationDto,
  RechercheGeoDto,
  ReverifierObsoletesDto,
  UpdateEtablissementDto,
  UpdatePharmacieDto,
  UpdateTarifConventionneDto,
} from './dto/provider.dto';
import { GeocodageService } from './geocodage.service';
import {
  Avertissement,
  ContexteAppelant,
  MOIS_REVERIFICATION_DEFAUT,
  RAYON_DOUBLON_KM,
  ROLES_GESTION_RESEAU,
} from './provider.types';
import { DependancesService } from '../dependances/dependances.service';

type Db = PrismaService | Prisma.TransactionClient;

interface PointGeo {
  latitude: number | null;
  longitude: number | null;
}

/**
 * ProviderService — réseau de soins : établissements de santé et pharmacies
 * (v9 phase 4.1, PROMPT 14).
 *
 * Écriture réservée à ASSUREUR_INFORMATIQUE (v9 §2.2). Lecture ouverte à toute
 * personne de l'organisation. Défense en profondeur : ce service vérifie
 * l'organisation + le rôle EN PLUS des policies RLS `profil_a_role`
 * (prisma/sql/009) — le chemin NestJS passe par `postgres` (pooler) et
 * contourne la RLS.
 *
 * Recherche géolocalisée : distance calculée en mémoire (formule de Haversine),
 * pas de PostGIS.
 */
@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly geocodage: GeocodageService,
    private readonly dependances: DependancesService,
  ) {}

  // --- Établissements de santé ---------------------------------------

  async creerEtablissement(
    user: AuthenticatedUser,
    dto: CreateEtablissementDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertCodeLibre('etablissementSante', dto.code);

    const { latitude, longitude, avertissements } = await this.resoudreCoords(
      dto,
    );
    const doublon = await this.detecterDoublons(
      'etablissementSante',
      ctx.organisationId,
      dto.nom,
      latitude,
      longitude,
    );
    if (doublon) avertissements.push(doublon);

    const id = await this.prisma.$transaction(async (tx) => {
      const e = await tx.etablissementSante.create({
        data: {
          organisationId: ctx.organisationId,
          nom: dto.nom,
          code: dto.code,
          typeEtablissement: dto.typeEtablissement,
          ...(dto.pays ? { pays: dto.pays } : {}),
          ville: dto.ville ?? null,
          commune: dto.commune ?? null,
          quartier: dto.quartier ?? null,
          adresseComplete: dto.adresseComplete ?? null,
          latitude,
          longitude,
          telephone: dto.telephone ?? null,
          telephoneUrgence: dto.telephoneUrgence ?? null,
          email: dto.email ?? null,
          ...(dto.statut ? { statut: dto.statut } : {}),
          dateConvention: dto.dateConvention
            ? new Date(dto.dateConvention)
            : null,
          dateFinConvention: dto.dateFinConvention
            ? new Date(dto.dateFinConvention)
            : null,
          gardeWeekend: dto.gardeWeekend ?? false,
          horairesGarde: (dto.horairesGarde ?? undefined) as Prisma.InputJsonValue,
          horairesSemaine: (dto.horairesSemaine ??
            undefined) as Prisma.InputJsonValue,
          tiersPayant: dto.tiersPayant ?? true,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_ETABLISSEMENT',
        e.id,
        {
          code: dto.code,
          type: dto.typeEtablissement,
          geocodageAuto: avertissements.some((a) => a.type === 'GEOCODAGE_AUTO'),
          doublonPossible: avertissements.some(
            (a) => a.type === 'DOUBLON_POSSIBLE',
          ),
        },
        'etablissements_sante',
      );
      return e.id;
    });

    const etablissement = await this.chargerEtablissement(ctx.organisationId, id);
    return { ...etablissement, avertissements };
  }

  async listerEtablissements(
    user: AuthenticatedUser,
    filtres: { type?: string; statut?: string; ville?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.etablissementSante.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.type ? { typeEtablissement: filtres.type } : {}),
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.ville
          ? { ville: { equals: filtres.ville, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { nom: 'asc' },
    });
  }

  async obtenirEtablissement(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerEtablissement(ctx.organisationId, id);
  }

  async modifierEtablissement(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEtablissementDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertEtablissementDansPerimetre(ctx.organisationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.etablissementSante.update({
        where: { id },
        data: this.lieuUpdateData(dto),
      });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_ETABLISSEMENT',
        id,
        { champs: Object.keys(dto) },
        'etablissements_sante',
      );
    });
    return this.chargerEtablissement(ctx.organisationId, id);
  }

  /**
   * Fait passer un établissement `EN_ATTENTE_VALIDATION` à `ACTIF` — action
   * dédiée (distincte du PATCH générique) pour rester exclusivement réservée à
   * ASSUREUR_INFORMATIQUE et tracée par un audit dédié (`VALIDATION_ETABLISSEMENT`).
   */
  async validerEtablissement(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const etablissement = await this.assertEtablissementDansPerimetre(
      ctx.organisationId,
      id,
    );

    if (etablissement.statut !== 'EN_ATTENTE_VALIDATION') {
      throw new ConflictException(
        `Cet établissement n'est pas en attente de validation (statut : ${etablissement.statut}).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.etablissementSante.update({
        where: { id },
        data: { statut: 'ACTIF' },
      });
      await this.audit(
        tx,
        ctx.userId,
        'VALIDATION_ETABLISSEMENT',
        id,
        { ancienStatut: 'EN_ATTENTE_VALIDATION', nouveauStatut: 'ACTIF' },
        'etablissements_sante',
      );
    });

    return this.chargerEtablissement(ctx.organisationId, id);
  }

  async supprimerEtablissement(
    user: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertEtablissementDansPerimetre(ctx.organisationId, id);

    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'etablissement', id, 'supprimer');

    await this.prisma.$transaction(async (tx) => {
      await tx.etablissementSante.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_ETABLISSEMENT',
        id,
        null,
        'etablissements_sante',
      );
    });
  }

  // --- Pharmacies ---------------------------------------------------

  async creerPharmacie(user: AuthenticatedUser, dto: CreatePharmacieDto) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertCodeLibre('pharmacie', dto.code);

    const { latitude, longitude, avertissements } = await this.resoudreCoords(
      dto,
    );
    const doublon = await this.detecterDoublons(
      'pharmacie',
      ctx.organisationId,
      dto.nom,
      latitude,
      longitude,
    );
    if (doublon) avertissements.push(doublon);

    const id = await this.prisma.$transaction(async (tx) => {
      const p = await tx.pharmacie.create({
        data: {
          organisationId: ctx.organisationId,
          nom: dto.nom,
          code: dto.code,
          ...(dto.pays ? { pays: dto.pays } : {}),
          ville: dto.ville ?? null,
          commune: dto.commune ?? null,
          quartier: dto.quartier ?? null,
          adresseComplete: dto.adresseComplete ?? null,
          latitude,
          longitude,
          telephone: dto.telephone ?? null,
          email: dto.email ?? null,
          ...(dto.statut ? { statut: dto.statut } : {}),
          gardeWeekend: dto.gardeWeekend ?? false,
          horairesGarde: (dto.horairesGarde ?? undefined) as Prisma.InputJsonValue,
          tiersPayant: dto.tiersPayant ?? true,
          dateConvention: dto.dateConvention
            ? new Date(dto.dateConvention)
            : null,
          dateFinConvention: dto.dateFinConvention
            ? new Date(dto.dateFinConvention)
            : null,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_PHARMACIE',
        p.id,
        {
          code: dto.code,
          geocodageAuto: avertissements.some((a) => a.type === 'GEOCODAGE_AUTO'),
          doublonPossible: avertissements.some(
            (a) => a.type === 'DOUBLON_POSSIBLE',
          ),
        },
        'pharmacies',
      );
      return p.id;
    });

    const pharmacie = await this.chargerPharmacie(ctx.organisationId, id);
    return { ...pharmacie, avertissements };
  }

  async listerPharmacies(
    user: AuthenticatedUser,
    filtres: { statut?: string; ville?: string },
  ) {
    const ctx = await this.contexteAppelant(user);
    return this.prisma.pharmacie.findMany({
      where: {
        organisationId: ctx.organisationId,
        deletedAt: null,
        ...(filtres.statut ? { statut: filtres.statut } : {}),
        ...(filtres.ville
          ? { ville: { equals: filtres.ville, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { nom: 'asc' },
    });
  }

  async obtenirPharmacie(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexteAppelant(user);
    return this.chargerPharmacie(ctx.organisationId, id);
  }

  async modifierPharmacie(
    user: AuthenticatedUser,
    id: string,
    dto: UpdatePharmacieDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertPharmacieDansPerimetre(ctx.organisationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.pharmacie.update({
        where: { id },
        data: this.lieuUpdateData(dto),
      });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_PHARMACIE',
        id,
        { champs: Object.keys(dto) },
        'pharmacies',
      );
    });
    return this.chargerPharmacie(ctx.organisationId, id);
  }

  async supprimerPharmacie(user: AuthenticatedUser, id: string): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.assertPharmacieDansPerimetre(ctx.organisationId, id);

    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'pharmacie', id, 'supprimer');

    await this.prisma.$transaction(async (tx) => {
      await tx.pharmacie.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_PHARMACIE',
        id,
        null,
        'pharmacies',
      );
    });
  }

  // --- Recherche géolocalisée -------------------------------------

  async rechercheGeolocalisee(user: AuthenticatedUser, dto: RechercheGeoDto) {
    const ctx = await this.contexteAppelant(user);
    if (dto.lat == null || dto.lng == null) {
      return this.annuaire(ctx.organisationId, dto);
    }
    const rayon = dto.rayonKm ?? 5;
    const limite = dto.limite ?? 50;
    const cible = dto.cible ?? 'TOUS';

    const resultat: {
      centre: { lat: number; lng: number };
      rayonKm: number;
      etablissements?: unknown[];
      pharmacies?: unknown[];
    } = { centre: { lat: dto.lat, lng: dto.lng }, rayonKm: rayon };

    if (cible === 'ETABLISSEMENTS' || cible === 'TOUS') {
      const etabs = await this.prisma.etablissementSante.findMany({
        where: {
          organisationId: ctx.organisationId,
          deletedAt: null,
          statut: 'ACTIF',
          latitude: { not: null },
          longitude: { not: null },
        },
      });
      resultat.etablissements = this.trierParDistance(
        etabs,
        dto.lat,
        dto.lng,
        rayon,
        limite,
      );
    }

    if (cible === 'PHARMACIES' || cible === 'TOUS') {
      const pharms = await this.prisma.pharmacie.findMany({
        where: {
          organisationId: ctx.organisationId,
          deletedAt: null,
          statut: 'ACTIVE',
          latitude: { not: null },
          longitude: { not: null },
        },
      });
      resultat.pharmacies = this.trierParDistance(
        pharms,
        dto.lat,
        dto.lng,
        rayon,
        limite,
      );
    }

    return resultat;
  }

  /**
   * Recherche sans position : annuaire des lieux actifs de l'organisation
   * (avec ou sans coordonnées), triés par nom. Même forme de réponse que la
   * recherche géolocalisée, sans `distanceKm` ; `centre` et `rayonKm` à `null`.
   * `limite` n'est appliquée que si elle est demandée.
   */
  private async annuaire(organisationId: string, dto: RechercheGeoDto) {
    const cible = dto.cible ?? 'TOUS';
    const commun = {
      orderBy: { nom: 'asc' as const },
      ...(dto.limite ? { take: dto.limite } : {}),
    };
    const resultat: {
      centre: null;
      rayonKm: null;
      etablissements?: unknown[];
      pharmacies?: unknown[];
    } = { centre: null, rayonKm: null };
    if (cible === 'ETABLISSEMENTS' || cible === 'TOUS') {
      resultat.etablissements = await this.prisma.etablissementSante.findMany({
        where: { organisationId, deletedAt: null, statut: 'ACTIF' },
        ...commun,
      });
    }
    if (cible === 'PHARMACIES' || cible === 'TOUS') {
      resultat.pharmacies = await this.prisma.pharmacie.findMany({
        where: { organisationId, deletedAt: null, statut: 'ACTIVE' },
        ...commun,
      });
    }
    return resultat;
  }

  /**
   * Filtre les lieux dans le rayon et les renvoie triés par distance croissante,
   * chacun enrichi de `distanceKm` (2 décimales).
   */
  private trierParDistance<T extends PointGeo>(
    lieux: T[],
    lat: number,
    lng: number,
    rayonKm: number,
    limite: number,
  ): (T & { distanceKm: number })[] {
    return lieux
      .map((lieu) => ({
        ...lieu,
        distanceKm: this.distanceHaversineKm(
          lat,
          lng,
          lieu.latitude as number,
          lieu.longitude as number,
        ),
      }))
      .filter((l) => l.distanceKm <= rayonKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limite)
      .map((l) => ({ ...l, distanceKm: Number(l.distanceKm.toFixed(2)) }));
  }

  /** Distance orthodromique (Haversine) en kilomètres. */
  private distanceHaversineKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371; // rayon moyen de la Terre en km
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // --- Automatisation : géocodage + doublons (v8 §9, PROMPT 15) -----

  /**
   * Coordonnées à insérer : celles fournies, sinon géocodage automatique
   * (Nominatim) si l'adresse le permet. Renvoie les avertissements associés
   * (géocodage auto réussi / échoué) — jamais bloquant.
   */
  private async resoudreCoords(dto: {
    latitude?: number;
    longitude?: number;
    adresseComplete?: string;
    quartier?: string;
    commune?: string;
    ville?: string;
    pays?: string;
  }): Promise<{
    latitude: number | null;
    longitude: number | null;
    avertissements: Avertissement[];
  }> {
    const avertissements: Avertissement[] = [];

    if (dto.latitude != null && dto.longitude != null) {
      return { latitude: dto.latitude, longitude: dto.longitude, avertissements };
    }

    if (!GeocodageService.estGeocodable(dto)) {
      return { latitude: null, longitude: null, avertissements };
    }

    const coords = await this.geocodage.geocoder(dto);
    if (coords) {
      avertissements.push({
        type: 'GEOCODAGE_AUTO',
        message: `Coordonnées résolues automatiquement (Nominatim) : ${coords.latitude.toFixed(
          5,
        )}, ${coords.longitude.toFixed(5)}. Vérifiez-les.`,
      });
      return { ...coords, avertissements };
    }

    avertissements.push({
      type: 'GEOCODAGE_ECHOUE',
      message:
        "Géocodage automatique impossible (adresse introuvable). Saisissez la latitude / longitude à la main.",
    });
    return { latitude: null, longitude: null, avertissements };
  }

  /** Normalise un nom pour la comparaison (minuscule, sans accents ni mots vides). */
  private normaliserNom(nom: string): string[] {
    const vides = new Set([
      'de',
      'du',
      'des',
      'la',
      'le',
      'les',
      'l',
      'd',
      'et',
      'a',
      'au',
      'aux',
      'clinique',
      'cabinet',
      'centre',
      'hopital',
      'hopitaux',
      'pharmacie',
      'polyclinique',
      'medical',
      'medicale',
      'sante',
      'dr',
      'docteur',
      'saint',
      'ste',
      'st',
    ]);
    return nom
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !vides.has(t));
  }

  /** Deux noms sont « similaires » si leurs jetons significatifs se recouvrent ≥ 50 %. */
  private nomsSimilaires(a: string, b: string): boolean {
    const ta = this.normaliserNom(a);
    const tb = this.normaliserNom(b);
    if (ta.length === 0 || tb.length === 0) return false;
    const setB = new Set(tb);
    const commun = ta.filter((t) => setB.has(t)).length;
    const jaccard = commun / new Set([...ta, ...tb]).size;
    return jaccard >= 0.5;
  }

  /**
   * Cherche un établissement / une pharmacie de la même organisation, au nom
   * similaire, dans un rayon de 200 m. Avertissement (jamais un blocage).
   */
  private async detecterDoublons(
    modele: 'etablissementSante' | 'pharmacie',
    organisationId: string,
    nom: string,
    latitude: number | null,
    longitude: number | null,
  ): Promise<Avertissement | null> {
    if (latitude == null || longitude == null) return null;

    const candidats =
      modele === 'etablissementSante'
        ? await this.prisma.etablissementSante.findMany({
            where: {
              organisationId,
              deletedAt: null,
              latitude: { not: null },
              longitude: { not: null },
            },
            select: { id: true, nom: true, latitude: true, longitude: true },
          })
        : await this.prisma.pharmacie.findMany({
            where: {
              organisationId,
              deletedAt: null,
              latitude: { not: null },
              longitude: { not: null },
            },
            select: { id: true, nom: true, latitude: true, longitude: true },
          });

    const proches = candidats
      .map((c) => ({
        id: c.id,
        nom: c.nom,
        distanceKm: this.distanceHaversineKm(
          latitude,
          longitude,
          c.latitude as number,
          c.longitude as number,
        ),
      }))
      .filter(
        (c) =>
          c.distanceKm <= RAYON_DOUBLON_KM && this.nomsSimilaires(nom, c.nom),
      )
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map((c) => ({ ...c, distanceKm: Number(c.distanceKm.toFixed(3)) }));

    if (proches.length === 0) return null;

    return {
      type: 'DOUBLON_POSSIBLE',
      message: `${proches.length} entrée(s) au nom proche à moins de 200 m — vérifiez qu'il ne s'agit pas d'un doublon.`,
      details: proches,
    };
  }

  // --- Vérification périodique (v8 §9, PROMPT 15) ------------------

  async enregistrerVerification(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    dto: EnregistrerVerificationDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    if (cible === 'etablissement') {
      await this.assertEtablissementDansPerimetre(ctx.organisationId, id);
    } else {
      await this.assertPharmacieDansPerimetre(ctx.organisationId, id);
    }

    const maintenant = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.verificationEtablissement.create({
        data: {
          etablissementId: cible === 'etablissement' ? id : null,
          pharmacieId: cible === 'pharmacie' ? id : null,
          dateVerification: maintenant,
          methode: dto.methode,
          statutConfirme: dto.statutConfirme,
          verifiePar: ctx.userId,
        },
      });
      const data = {
        verificationStatut: dto.statutConfirme,
        dateDerniereVerification: maintenant,
      };
      if (cible === 'etablissement') {
        await tx.etablissementSante.update({ where: { id }, data });
      } else {
        await tx.pharmacie.update({ where: { id }, data });
      }
      await this.audit(
        tx,
        ctx.userId,
        'VERIFICATION_RESEAU',
        id,
        {
          cible,
          methode: dto.methode,
          statutConfirme: dto.statutConfirme,
          commentaire: dto.commentaire ?? null,
        },
        cible === 'etablissement' ? 'etablissements_sante' : 'pharmacies',
      );
    });

    return cible === 'etablissement'
      ? this.chargerEtablissement(ctx.organisationId, id)
      : this.chargerPharmacie(ctx.organisationId, id);
  }

  async listerVerifications(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (cible === 'etablissement') {
      await this.assertEtablissementDansPerimetre(ctx.organisationId, id);
      return this.prisma.verificationEtablissement.findMany({
        where: { etablissementId: id },
        orderBy: { dateVerification: 'desc' },
      });
    }
    await this.assertPharmacieDansPerimetre(ctx.organisationId, id);
    return this.prisma.verificationEtablissement.findMany({
      where: { pharmacieId: id },
      orderBy: { dateVerification: 'desc' },
    });
  }

  // --- Tarifs conventionnés (v3 §5, plan directeur phase 4.2) -------
  //
  // Fonctionnalité prévue au plan mais jamais implémentée jusqu'ici (confirmé
  // par diagnostic) — DIFFÉRENTE de `grilles_tarifaires` (cotisation par
  // tranche d'âge/souscripteur, PROMPT 11). Utilisée par le microservice
  // d'adjudication : min(montant_facture, tarif_convention) avant application
  // du taux de couverture (JdbcAdjudicationRepository.SQL_CONTEXTE).

  async creerTarif(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    dto: CreateTarifConventionneDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    if (cible === 'etablissement') {
      await this.assertEtablissementDansPerimetre(ctx.organisationId, id);
    } else {
      await this.assertPharmacieDansPerimetre(ctx.organisationId, id);
    }

    const acte = await this.prisma.referentielActe.findFirst({
      where: {
        id: dto.referentielActeId,
        organisationId: ctx.organisationId,
        deletedAt: null,
      },
    });
    if (!acte) {
      throw new NotFoundException('Acte introuvable dans votre organisation.');
    }

    // Historique (prisma/sql/072) : plusieurs tarifs successifs pour un même acte,
    // jamais sur des périodes qui se chevauchent.
    await this.assertSansChevauchement(
      cible,
      id,
      dto.referentielActeId,
      acte.libelle,
      new Date(dto.dateDebut),
      dto.dateFin ? new Date(dto.dateFin) : null,
    );

    const tarif = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tarifConventionne.create({
        data: {
          organisationId: ctx.organisationId,
          etablissementId: cible === 'etablissement' ? id : null,
          pharmacieId: cible === 'pharmacie' ? id : null,
          referentielActeId: dto.referentielActeId,
          tarifConvention: dto.tarifConvention,
          dateDebut: new Date(dto.dateDebut),
          dateFin: dto.dateFin ? new Date(dto.dateFin) : null,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CREATION_TARIF_CONVENTIONNE',
        t.id,
        {
          cible,
          cibleId: id,
          referentielActeId: dto.referentielActeId,
          tarifConvention: dto.tarifConvention,
        },
        'tarifs_conventionnes',
      );
      return t;
    });

    return this.chargerTarif(ctx.organisationId, tarif.id);
  }

  async listerTarifs(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
  ) {
    const ctx = await this.contexteAppelant(user);
    if (cible === 'etablissement') {
      await this.assertEtablissementDansPerimetre(ctx.organisationId, id);
    } else {
      await this.assertPharmacieDansPerimetre(ctx.organisationId, id);
    }
    return this.prisma.tarifConventionne.findMany({
      where: {
        deletedAt: null,
        ...(cible === 'etablissement'
          ? { etablissementId: id }
          : { pharmacieId: id }),
      },
      include: {
        referentielActe: { select: { code: true, libelle: true, categorie: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async modifierTarif(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    tarifId: string,
    dto: UpdateTarifConventionneDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const actuel = await this.chargerTarifDansPerimetre(ctx.organisationId, cible, id, tarifId);
    if (dto.dateDebut !== undefined || dto.dateFin !== undefined) {
      const acte = await this.prisma.referentielActe.findUnique({
        where: { id: actuel.referentielActeId },
        select: { libelle: true },
      });
      await this.assertSansChevauchement(
        cible,
        id,
        actuel.referentielActeId,
        acte?.libelle ?? 'cet acte',
        dto.dateDebut !== undefined ? new Date(dto.dateDebut) : actuel.dateDebut,
        dto.dateFin !== undefined ? (dto.dateFin ? new Date(dto.dateFin) : null) : actuel.dateFin,
        tarifId,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tarifConventionne.update({
        where: { id: tarifId },
        data: {
          ...(dto.tarifConvention !== undefined
            ? { tarifConvention: dto.tarifConvention }
            : {}),
          ...(dto.dateDebut !== undefined
            ? { dateDebut: new Date(dto.dateDebut) }
            : {}),
          ...(dto.dateFin !== undefined
            ? { dateFin: dto.dateFin ? new Date(dto.dateFin) : null }
            : {}),
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'MODIFICATION_TARIF_CONVENTIONNE',
        tarifId,
        { champs: Object.keys(dto) },
        'tarifs_conventionnes',
      );
    });

    return this.chargerTarif(ctx.organisationId, tarifId);
  }

  async supprimerTarif(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    tarifId: string,
  ): Promise<void> {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    await this.chargerTarifDansPerimetre(ctx.organisationId, cible, id, tarifId);

    // ADR-007 : aucune suppression d'un élément encore lié (409 + raison, refus tracé)
    await this.dependances.assertPossible(user, 'tarif', tarifId, 'supprimer');

    await this.prisma.$transaction(async (tx) => {
      await tx.tarifConventionne.update({
        where: { id: tarifId },
        data: { deletedAt: new Date() },
      });
      await this.audit(
        tx,
        ctx.userId,
        'SUPPRESSION_TARIF_CONVENTIONNE',
        tarifId,
        null,
        'tarifs_conventionnes',
      );
    });
  }

  private async chargerTarif(organisationId: string, id: string) {
    const t = await this.prisma.tarifConventionne.findFirst({
      where: { id, organisationId, deletedAt: null },
      include: {
        referentielActe: { select: { code: true, libelle: true, categorie: true } },
      },
    });
    if (!t) {
      throw new NotFoundException('Tarif conventionné introuvable.');
    }
    return t;
  }

  /**
   * Un même acte peut avoir plusieurs tarifs SUCCESSIFS (historique, prisma/sql/072 :
   * le tarif applicable est celui en vigueur à la date des soins) mais jamais deux
   * tarifs valables le même jour. 409 explicite plutôt que l'erreur de la contrainte.
   */
  private async assertSansChevauchement(
    cible: 'etablissement' | 'pharmacie',
    cibleId: string,
    referentielActeId: string,
    libelleActe: string,
    debut: Date,
    fin: Date | null,
    exclureTarifId?: string,
  ): Promise<void> {
    const conflit = await this.prisma.tarifConventionne.findFirst({
      where: {
        referentielActeId,
        deletedAt: null,
        ...(cible === 'etablissement' ? { etablissementId: cibleId } : { pharmacieId: cibleId }),
        ...(exclureTarifId ? { id: { not: exclureTarifId } } : {}),
        // [debut, fin] ∩ [t.dateDebut, t.dateFin] ≠ ∅ (fin nulle = sans fin)
        ...(fin ? { dateDebut: { lte: fin } } : {}),
        OR: [{ dateFin: null }, { dateFin: { gte: debut } }],
      },
      orderBy: { dateDebut: 'asc' },
    });
    if (conflit) {
      const jj = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
      throw new ConflictException(
        `Un tarif conventionné de « ${libelleActe} » est déjà en vigueur sur cette période ` +
          `(du ${jj(conflit.dateDebut)}${conflit.dateFin ? ` au ${jj(conflit.dateFin)}` : ', sans date de fin'}). ` +
          "Pour changer de tarif, fixez la date de fin de l'ancien (la veille du nouveau), puis créez le nouveau : l'historique est conservé et chaque soin est remboursé au tarif en vigueur à sa date.",
      );
    }
  }

  private async chargerTarifDansPerimetre(
    organisationId: string,
    cible: 'etablissement' | 'pharmacie',
    cibleId: string,
    tarifId: string,
  ) {
    const t = await this.prisma.tarifConventionne.findFirst({
      where: {
        id: tarifId,
        organisationId,
        deletedAt: null,
        ...(cible === 'etablissement'
          ? { etablissementId: cibleId }
          : { pharmacieId: cibleId }),
      },
    });
    if (!t) {
      throw new NotFoundException('Tarif conventionné introuvable.');
    }
    return t;
  }

  /**
   * Tâche planifiée (déclenchable à la main pour l'instant) : marque
   * `A_REVERIFIER` tout établissement / toute pharmacie de l'organisation non
   * vérifié depuis plus de `moisMax` mois (défaut 12). **Aucune désactivation** —
   * juste une alerte visible. Idempotent.
   */
  async reverifierObsoletes(
    user: AuthenticatedUser,
    dto: ReverifierObsoletesDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);

    const mois = dto.moisMax ?? MOIS_REVERIFICATION_DEFAUT;
    const seuil = new Date();
    seuil.setMonth(seuil.getMonth() - mois);

    // Règle métier : jamais vérifié, ou dernière vérification trop ancienne.
    // On ne filtre PAS sur `verification_statut` (le `not` de Prisma exclut les
    // NULL sur ce champ) : la tâche est idempotente — ré-appliquer `A_REVERIFIER`
    // sur une entrée déjà marquée est sans effet, et `count` reflète alors le
    // total d'entrées « à revérifier », ce qui reste l'information utile.
    const conditionObsolete = {
      organisationId: ctx.organisationId,
      deletedAt: null,
      OR: [
        { dateDerniereVerification: null },
        { dateDerniereVerification: { lt: seuil } },
      ],
    };

    const [etabs, pharms] = await this.prisma.$transaction([
      this.prisma.etablissementSante.updateMany({
        where: conditionObsolete,
        data: { verificationStatut: 'A_REVERIFIER' },
      }),
      this.prisma.pharmacie.updateMany({
        where: conditionObsolete,
        data: { verificationStatut: 'A_REVERIFIER' },
      }),
    ]);

    await this.audit(
      this.prisma,
      ctx.userId,
      'REVERIFICATION_RESEAU_OBSOLETES',
      ctx.organisationId,
      {
        moisMax: mois,
        etablissementsMarques: etabs.count,
        pharmaciesMarquees: pharms.count,
      },
      'etablissements_sante',
    );

    return {
      moisMax: mois,
      seuil: seuil.toISOString().slice(0, 10),
      etablissementsMarques: etabs.count,
      pharmaciesMarquees: pharms.count,
    };
  }

  // --- Autorisation / helpers ------------------------------------

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
    };
  }

  private assertGestion(ctx: ContexteAppelant): void {
    const autorise = ctx.roleChain.some((code) =>
      (ROLES_GESTION_RESEAU as readonly string[]).includes(code),
    );
    if (!autorise) {
      throw new ForbiddenException(
        'La gestion du réseau de soins est réservée à ASSUREUR_INFORMATIQUE.',
      );
    }
  }

  private async assertCodeLibre(
    modele: 'etablissementSante' | 'pharmacie',
    code: string,
  ): Promise<void> {
    const existe =
      modele === 'etablissementSante'
        ? await this.prisma.etablissementSante.findUnique({ where: { code } })
        : await this.prisma.pharmacie.findUnique({ where: { code } });
    if (existe) {
      throw new ConflictException(`Le code « ${code} » est déjà utilisé.`);
    }
  }

  private lieuUpdateData(
    dto: UpdateEtablissementDto | UpdatePharmacieDto,
  ): Record<string, unknown> {
    const d: Record<string, unknown> = {};
    for (const [cle, valeur] of Object.entries(dto)) {
      if (valeur === undefined) continue;
      if (
        (cle === 'dateConvention' || cle === 'dateFinConvention') &&
        typeof valeur === 'string'
      ) {
        d[cle] = new Date(valeur);
      } else {
        d[cle] = valeur;
      }
    }
    return d;
  }

  private async chargerEtablissement(organisationId: string, id: string) {
    const e = await this.prisma.etablissementSante.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!e) {
      throw new NotFoundException('Établissement introuvable.');
    }
    return e;
  }

  private async assertEtablissementDansPerimetre(
    organisationId: string,
    id: string,
  ) {
    const e = await this.prisma.etablissementSante.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!e) {
      throw new NotFoundException('Établissement introuvable.');
    }
    return e;
  }

  private async chargerPharmacie(organisationId: string, id: string) {
    const p = await this.prisma.pharmacie.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!p) {
      throw new NotFoundException('Pharmacie introuvable.');
    }
    return p;
  }

  private async assertPharmacieDansPerimetre(
    organisationId: string,
    id: string,
  ) {
    const p = await this.prisma.pharmacie.findFirst({
      where: { id, organisationId, deletedAt: null },
    });
    if (!p) {
      throw new NotFoundException('Pharmacie introuvable.');
    }
    return p;
  }

  /** Écriture d'audit — toujours via `log_audit()` (v9 §1.6). */
  private async audit(
    db: Db,
    userId: string,
    action: string,
    enregistrementId: string,
    details: Prisma.InputJsonValue | null,
    tableCible: string,
  ): Promise<void> {
    try {
      await db.$executeRaw`
        SELECT log_audit(
          ${action}::text,
          ${tableCible}::text,
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
