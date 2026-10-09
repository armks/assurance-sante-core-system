import {
  BadRequestException,
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
  ChangerTarifConventionneDto,
  FermerTarifConventionneDto,
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
/** « 2026-03-01 » ou ISO complet → minuit UTC du jour (colonnes @db.Date). */
function jourUtc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

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
    return this.modifierLieu('etablissement', user, id, dto);
  }

  async archiverEtablissement(user: AuthenticatedUser, id: string) {
    return this.changerArchivage('etablissement', user, id, 'archiver');
  }

  async desarchiverEtablissement(user: AuthenticatedUser, id: string) {
    return this.changerArchivage('etablissement', user, id, 'desarchiver');
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
    return this.modifierLieu('pharmacie', user, id, dto);
  }

  async archiverPharmacie(user: AuthenticatedUser, id: string) {
    return this.changerArchivage('pharmacie', user, id, 'archiver');
  }

  async desarchiverPharmacie(user: AuthenticatedUser, id: string) {
    return this.changerArchivage('pharmacie', user, id, 'desarchiver');
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

  /** Les tarifs d'un ÉTABLISSEMENT se gèrent dans sa convention (prisma/sql/081) ; ceux d'une pharmacie restent ici. */
  private assertTarifsPharmacieSeulement(cible: 'etablissement' | 'pharmacie'): void {
    if (cible === 'etablissement') {
      throw new ConflictException(
        'Les tarifs d’un établissement se gèrent dans sa convention (circuit de validation) : ouvrez « Conventions ».',
      );
    }
  }

  async creerTarif(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    dto: CreateTarifConventionneDto,
  ) {
    this.assertTarifsPharmacieSeulement(cible);
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
    this.assertTarifsPharmacieSeulement(cible);
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const actuel = await this.chargerTarifDansPerimetre(ctx.organisationId, cible, id, tarifId);
    // ADR-007 : un tarif ayant servi à un calcul ne se modifie plus — « Changer à partir du… »
    await this.dependances.assertPossible(user, 'tarif', tarifId, 'modifier');
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
    this.assertTarifsPharmacieSeulement(cible);
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

  /**
   * « Changer à partir du… » (ADR-007) : UNE action, UNE transaction — l'ancien tarif est
   * fermé la veille de `aPartirDu`, le nouveau montant vaut à partir de cette date
   * (jusqu'à l'ancienne date de fin éventuelle). Chaque soin reste remboursé au tarif en
   * vigueur à sa date ; refusé si des actes déjà calculés avec l'ancien tarif ont des
   * soins à partir de cette date.
   */
  async changerTarif(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    tarifId: string,
    dto: ChangerTarifConventionneDto,
  ) {
    this.assertTarifsPharmacieSeulement(cible);
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const ancien = await this.chargerTarifDansPerimetre(ctx.organisationId, cible, id, tarifId);
    const aPartirDu = jourUtc(dto.aPartirDu);
    const jj = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
    if (aPartirDu <= ancien.dateDebut) {
      throw new ConflictException(
        `Le nouveau tarif doit commencer après le début de l'actuel (${jj(ancien.dateDebut)}). Pour corriger un tarif jamais utilisé, modifiez-le.`,
      );
    }
    if (ancien.dateFin && aPartirDu > ancien.dateFin) {
      throw new ConflictException(
        `Ce tarif est fermé depuis le ${jj(ancien.dateFin)} : créez un nouveau tarif plutôt que de le changer.`,
      );
    }
    await this.assertSoinsCalculesAvant(tarifId, aPartirDu, 'changer le tarif');

    const veille = new Date(aPartirDu.getTime() - 86_400_000);
    const nouveau = await this.prisma.$transaction(async (tx) => {
      await tx.tarifConventionne.update({ where: { id: tarifId }, data: { dateFin: veille } });
      const t = await tx.tarifConventionne.create({
        data: {
          organisationId: ctx.organisationId,
          etablissementId: ancien.etablissementId,
          pharmacieId: ancien.pharmacieId,
          referentielActeId: ancien.referentielActeId,
          tarifConvention: dto.tarifConvention,
          dateDebut: aPartirDu,
          dateFin: ancien.dateFin,
        },
      });
      await this.audit(
        tx,
        ctx.userId,
        'CHANGEMENT_TARIF_CONVENTIONNE',
        t.id,
        {
          cible,
          cibleId: id,
          ancienTarifId: tarifId,
          ancienMontant: ancien.tarifConvention.toFixed(2),
          nouveauMontant: dto.tarifConvention.toFixed(2),
          aPartirDu: dto.aPartirDu.slice(0, 10),
        },
        'tarifs_conventionnes',
      );
      return t;
    });
    return this.chargerTarif(ctx.organisationId, nouveau.id);
  }

  /** Archivage = FERMETURE du tarif (date de fin, aujourd'hui par défaut). */
  async fermerTarif(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    tarifId: string,
    dto: FermerTarifConventionneDto,
  ) {
    this.assertTarifsPharmacieSeulement(cible);
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const tarif = await this.chargerTarifDansPerimetre(ctx.organisationId, cible, id, tarifId);
    await this.dependances.assertPossible(user, 'tarif', tarifId, 'archiver');
    const dateFin = dto.dateFin ? jourUtc(dto.dateFin) : jourUtc(new Date().toISOString());
    if (dateFin < tarif.dateDebut) {
      throw new BadRequestException('La date de fin ne peut pas précéder le début du tarif.');
    }
    await this.assertSoinsCalculesAvant(tarifId, new Date(dateFin.getTime() + 86_400_000), 'fermer le tarif à cette date');

    await this.prisma.$transaction(async (tx) => {
      await tx.tarifConventionne.update({ where: { id: tarifId }, data: { dateFin } });
      await this.audit(tx, ctx.userId, 'FERMETURE_TARIF_CONVENTIONNE', tarifId,
        { dateFin: dateFin.toISOString().slice(0, 10) }, 'tarifs_conventionnes');
    });
    return this.chargerTarif(ctx.organisationId, tarifId);
  }

  /** Désarchivage = RÉOUVERTURE (date de fin retirée), si aucun tarif suivant n'existe. */
  async rouvrirTarif(
    user: AuthenticatedUser,
    cible: 'etablissement' | 'pharmacie',
    id: string,
    tarifId: string,
  ) {
    this.assertTarifsPharmacieSeulement(cible);
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const tarif = await this.chargerTarifDansPerimetre(ctx.organisationId, cible, id, tarifId);
    await this.dependances.assertPossible(user, 'tarif', tarifId, 'desarchiver');

    await this.prisma.$transaction(async (tx) => {
      await tx.tarifConventionne.update({ where: { id: tarifId }, data: { dateFin: null } });
      await this.audit(tx, ctx.userId, 'REOUVERTURE_TARIF_CONVENTIONNE', tarifId,
        { ancienneDateFin: tarif.dateFin?.toISOString().slice(0, 10) ?? null }, 'tarifs_conventionnes');
    });
    return this.chargerTarif(ctx.organisationId, tarifId);
  }

  /**
   * Un acte calculé avec ce tarif dont les soins sont postérieurs ou égaux à `limite`
   * rendrait l'historique faux (il aurait été calculé avec un tarif qui ne valait plus).
   */
  private async assertSoinsCalculesAvant(tarifId: string, limite: Date, quoi: string): Promise<void> {
    const n = await this.prisma.acteDossier.count({
      where: {
        tarifConventionneId: tarifId,
        OR: [
          { dateRealisation: { gte: limite } },
          { dateRealisation: null, datePrescription: { gte: limite } },
        ],
      },
    });
    if (n > 0) {
      const jj = limite.toISOString().slice(0, 10).split('-').reverse().join('/');
      throw new ConflictException(
        `Impossible de ${quoi} : ${n} acte${n > 1 ? 's' : ''} calculé${n > 1 ? 's' : ''} avec ce tarif ${n > 1 ? 'ont' : 'a'} des soins à partir du ${jj}. Choisissez une date postérieure.`,
      );
    }
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
    // unique parmi les NON supprimés (index partiel, prisma/sql/074) : un code supprimé se réutilise
    const existe =
      (modele === 'etablissementSante'
        ? await this.prisma.etablissementSante.count({ where: { code, deletedAt: null } })
        : await this.prisma.pharmacie.count({ where: { code, deletedAt: null } })) > 0;
    if (existe) {
      throw new ConflictException(`Le code « ${code} » est déjà utilisé.`);
    }
  }

  // --- Modification et archivage communs aux établissements et pharmacies (lot 3, ADR-007) ---

  private static readonly CHAMPS_ADRESSE = ['adresseComplete', 'quartier', 'commune', 'ville', 'pays'] as const;
  private static readonly STATUT_ARCHIVE = { etablissement: 'RESILIE', pharmacie: 'RESILIEE' } as const;
  private static readonly STATUT_ACTIF = { etablissement: 'ACTIF', pharmacie: 'ACTIVE' } as const;

  /**
   * Modification d'un établissement / d'une pharmacie : contact et adresse libres ;
   * `nom` et `code` tracés (ancienne et nouvelle valeur) à l'audit ; code unique parmi
   * les non supprimés. Un élément archivé ne se modifie pas (désarchivez-le d'abord) et
   * l'archivage passe par son action dédiée, jamais par `statut`. Un changement
   * d'adresse relance le géocodage Nominatim — sans jamais bloquer l'enregistrement.
   */
  private async modifierLieu(
    cible: 'etablissement' | 'pharmacie',
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEtablissementDto | UpdatePharmacieDto,
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const modele = cible === 'etablissement' ? 'etablissementSante' : 'pharmacie';
    const avant: any =
      cible === 'etablissement'
        ? await this.assertEtablissementDansPerimetre(ctx.organisationId, id)
        : await this.assertPharmacieDansPerimetre(ctx.organisationId, id);

    // ADR-007 : élément archivé → 409 (refus tracé)
    await this.dependances.assertPossible(user, cible, id, 'modifier');

    if (dto.statut === ProviderService.STATUT_ARCHIVE[cible]) {
      throw new ConflictException(
        `Pour archiver ${cible === 'etablissement' ? "l'établissement" : 'la pharmacie'}, utilisez l'action « Archiver » : elle vérifie qu'aucune activité n'est en cours.`,
      );
    }
    if (dto.code !== undefined && dto.code !== avant.code) {
      await this.assertCodeLibre(modele, dto.code);
    }

    const data = this.lieuUpdateData(dto);
    const avertissements: Avertissement[] = [];
    const adresseChangee = ProviderService.CHAMPS_ADRESSE.some(
      (k) => (dto as any)[k] !== undefined && (dto as any)[k] !== avant[k],
    );
    const coordsFournies = dto.latitude != null && dto.longitude != null;
    if (adresseChangee && !coordsFournies) {
      const adresse = Object.fromEntries(
        ProviderService.CHAMPS_ADRESSE.map((k) => [k, (dto as any)[k] ?? avant[k]]),
      );
      let coords: { latitude: number; longitude: number } | null = null;
      try {
        coords = await this.geocodage.geocoder(adresse);
      } catch (err) {
        this.logger.warn(`Géocodage impossible (modification) : ${err instanceof Error ? err.message : String(err)}`);
      }
      if (coords) {
        data.latitude = coords.latitude;
        data.longitude = coords.longitude;
        avertissements.push({
          type: 'GEOCODAGE_AUTO',
          message: `Adresse modifiée : position recalculée automatiquement (Nominatim) : ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}. Vérifiez-la.`,
        });
      } else {
        // l'ancienne position ne correspond plus à la nouvelle adresse : on ne la garde pas
        data.latitude = null;
        data.longitude = null;
        avertissements.push({
          type: 'GEOCODAGE_ECHOUE',
          message:
            "Adresse enregistrée, mais le géocodage automatique a échoué : l'ancienne position a été retirée de la carte. Saisissez la latitude / longitude à la main.",
        });
      }
    }

    const details: Record<string, unknown> = { champs: Object.keys(dto) };
    if (dto.nom !== undefined && dto.nom !== avant.nom) details.nom = { avant: avant.nom, apres: dto.nom };
    if (dto.code !== undefined && dto.code !== avant.code) details.code = { avant: avant.code, apres: dto.code };
    if (adresseChangee) {
      details.adresseModifiee = true;
      details.geocodage = avertissements.some((a) => a.type === 'GEOCODAGE_AUTO') ? 'AUTO' : coordsFournies ? 'MANUEL' : 'ECHEC';
    }

    await this.prisma.$transaction(async (tx) => {
      if (cible === 'etablissement') {
        await tx.etablissementSante.update({ where: { id }, data });
      } else {
        await tx.pharmacie.update({ where: { id }, data });
      }
      await this.audit(
        tx,
        ctx.userId,
        cible === 'etablissement' ? 'MODIFICATION_ETABLISSEMENT' : 'MODIFICATION_PHARMACIE',
        id,
        details as Prisma.InputJsonValue,
        cible === 'etablissement' ? 'etablissements_sante' : 'pharmacies',
      );
    });

    const apres =
      cible === 'etablissement'
        ? await this.chargerEtablissement(ctx.organisationId, id)
        : await this.chargerPharmacie(ctx.organisationId, id);
    return { ...apres, avertissements };
  }

  /**
   * Archivage (RESILIE / RESILIEE) et désarchivage (ACTIF / ACTIVE). Le serveur refuse
   * (409, raison et nombres en français, refus tracé) tant qu'une activité est en cours.
   * Succès : statut et audit dans UNE transaction. Le désarchivage ne réactive PAS les
   * comptes rattachés : ils restent coupés tant qu'ils n'ont pas été rétablis un à un.
   */
  private async changerArchivage(
    cible: 'etablissement' | 'pharmacie',
    user: AuthenticatedUser,
    id: string,
    action: 'archiver' | 'desarchiver',
  ) {
    const ctx = await this.contexteAppelant(user);
    this.assertGestion(ctx);
    const avant: any =
      cible === 'etablissement'
        ? await this.assertEtablissementDansPerimetre(ctx.organisationId, id)
        : await this.assertPharmacieDansPerimetre(ctx.organisationId, id);
    await this.dependances.assertPossible(user, cible, id, action);

    const nouveau = action === 'archiver' ? ProviderService.STATUT_ARCHIVE[cible] : ProviderService.STATUT_ACTIF[cible];
    await this.prisma.$transaction(async (tx) => {
      if (cible === 'etablissement') {
        await tx.etablissementSante.update({ where: { id }, data: { statut: nouveau } });
      } else {
        await tx.pharmacie.update({ where: { id }, data: { statut: nouveau } });
      }
      // Archivage : les comptes rattachés sont DÉSACTIVÉS (dans la même transaction). Le
      // désarchivage ne les réactive PAS : l'informatique les rétablit un à un.
      let comptesDesactives = 0;
      if (action === 'archiver') {
        const r = await tx.profil.updateMany({
          where: {
            organisationId: ctx.organisationId,
            deletedAt: null,
            desactiveLe: null,
            ...(cible === 'etablissement' ? { etablissementId: id } : { pharmacieId: id }),
          },
          data: {
            desactiveLe: new Date(),
            desactiveMotif: `archivage ${cible === 'etablissement' ? "de l'établissement" : 'de la pharmacie'} « ${avant.nom} »`,
          },
        });
        comptesDesactives = r.count;
      }
      await this.audit(
        tx,
        ctx.userId,
        `${action === 'archiver' ? 'ARCHIVAGE' : 'DESARCHIVAGE'}_${cible === 'etablissement' ? 'ETABLISSEMENT' : 'PHARMACIE'}`,
        id,
        { ancienStatut: avant.statut, nouveauStatut: nouveau, ...(action === 'archiver' ? { comptesDesactives } : {}) },
        cible === 'etablissement' ? 'etablissements_sante' : 'pharmacies',
      );
    });
    return cible === 'etablissement'
      ? this.chargerEtablissement(ctx.organisationId, id)
      : this.chargerPharmacie(ctx.organisationId, id);
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
