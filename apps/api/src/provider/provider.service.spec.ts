import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RechercheGeoDto } from './dto/provider.dto';
import { GeocodageService } from './geocodage.service';
import { ProviderService } from './provider.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'info@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function identite(roleChain: string[], organisationId: string | null = 'org-1') {
  return {
    profil: { id: 'u1', organisationId, entite: 'ASSUREUR' },
    permissions: roleChain.length ? { roleChain } : null,
  };
}

describe('ProviderService', () => {
  let service: ProviderService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let geocodage: { geocoder: jest.Mock };

  beforeEach(async () => {
    prisma = {
      etablissementSante: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      pharmacie: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      verificationEtablissement: {
        create: jest.fn().mockResolvedValue({ id: 'v1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      referentielActe: {
        findFirst: jest.fn(),
      },
      tarifConventionne: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    identity = { getMe: jest.fn() };
    geocodage = { geocoder: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: GeocodageService, useValue: geocodage },
      ],
    }).compile();

    service = moduleRef.get(ProviderService);
  });

  it('crée un établissement de santé (ASSUREUR_INFORMATIQUE)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.create.mockResolvedValue({ id: 'e1' });
    prisma.etablissementSante.findFirst.mockResolvedValue({
      id: 'e1',
      nom: 'Clinique X',
      code: 'CLX',
      statut: 'EN_ATTENTE_VALIDATION',
    });

    const res = await service.creerEtablissement(USER, {
      nom: 'Clinique X',
      code: 'CLX',
      typeEtablissement: 'CLINIQUE_PRIVEE',
      latitude: 5.35,
      longitude: -4.0,
    });

    expect(prisma.etablissementSante.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: 'org-1',
          code: 'CLX',
          typeEtablissement: 'CLINIQUE_PRIVEE',
        }),
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit
    expect(res.id).toBe('e1');
  });

  it('refuse la création par un rôle non autorisé (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));

    await expect(
      service.creerEtablissement(USER, {
        nom: 'X',
        code: 'X1',
        typeEtablissement: 'LABORATOIRE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.etablissementSante.create).not.toHaveBeenCalled();
  });

  it('refuse la création à un compte sans organisation', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ASSUREUR_INFORMATIQUE'], null),
    );
    await expect(
      service.creerEtablissement(USER, {
        nom: 'X',
        code: 'X1',
        typeEtablissement: 'LABORATOIRE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // --- validerEtablissement : EN_ATTENTE_VALIDATION → ACTIF ------------

  it('validerEtablissement : fait passer EN_ATTENTE_VALIDATION à ACTIF et audite VALIDATION_ETABLISSEMENT', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue({
      id: 'e1',
      statut: 'EN_ATTENTE_VALIDATION',
    });

    const res = await service.validerEtablissement(USER, 'e1');

    expect(prisma.etablissementSante.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { statut: 'ACTIF' },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit(VALIDATION_ETABLISSEMENT, …)
    expect(res.id).toBe('e1');
  });

  it('validerEtablissement : refuse (409) un établissement qui n’est pas EN_ATTENTE_VALIDATION', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue({
      id: 'e1',
      statut: 'ACTIF',
    });

    await expect(service.validerEtablissement(USER, 'e1')).rejects.toThrow(
      "n'est pas en attente de validation",
    );
    expect(prisma.etablissementSante.update).not.toHaveBeenCalled();
  });

  it('validerEtablissement : refuse un rôle non ASSUREUR_INFORMATIQUE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));

    await expect(
      service.validerEtablissement(USER, 'e1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.etablissementSante.update).not.toHaveBeenCalled();
  });

  it('validerEtablissement : 404 si l’établissement n’appartient pas à l’organisation de l’appelant', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue(null);

    await expect(
      service.validerEtablissement(USER, 'e-autre-org'),
    ).rejects.toThrow('Établissement introuvable.');
    expect(prisma.etablissementSante.update).not.toHaveBeenCalled();
  });

  it('recherche géolocalisée : résultats triés par distance croissante, hors rayon exclus', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    // Abidjan Plateau ~ (5.32, -4.02)
    prisma.etablissementSante.findMany.mockResolvedValue([
      { id: 'loin', nom: 'Bouaké', latitude: 7.69, longitude: -5.03 }, // ~300 km
      { id: 'proche', nom: 'Cocody', latitude: 5.35, longitude: -3.98 }, // ~5 km
      { id: 'moyen', nom: 'Yopougon', latitude: 5.34, longitude: -4.08 }, // ~7 km
    ]);
    prisma.pharmacie.findMany.mockResolvedValue([]);

    const res = await service.rechercheGeolocalisee(USER, {
      lat: 5.32,
      lng: -4.02,
      rayonKm: 20,
      cible: 'TOUS',
    });

    const ids = (res.etablissements as { id: string; distanceKm: number }[]).map(
      (e) => e.id,
    );
    expect(ids).toEqual(['proche', 'moyen']); // 'loin' hors rayon
    const distances = (
      res.etablissements as { distanceKm: number }[]
    ).map((e) => e.distanceKm);
    expect(distances[0]).toBeLessThan(distances[1]);
    expect(distances.every((d) => d <= 20)).toBe(true);
  });

  it('recherche géolocalisée : cible ETABLISSEMENTS n’interroge pas les pharmacies', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findMany.mockResolvedValue([]);

    const res = await service.rechercheGeolocalisee(USER, {
      lat: 5.32,
      lng: -4.02,
      cible: 'ETABLISSEMENTS',
    });

    expect(prisma.pharmacie.findMany).not.toHaveBeenCalled();
    expect(res.pharmacies).toBeUndefined();
    expect(res.rayonKm).toBe(5); // défaut
  });

  it('recherche sans position : annuaire des lieux actifs de l’organisation, triés par nom, sans filtre de coordonnées', async () => {
    identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE']));
    prisma.etablissementSante.findMany.mockResolvedValue([
      { id: 'a', nom: 'Clinique A', latitude: null, longitude: null },
    ]);
    prisma.pharmacie.findMany.mockResolvedValue([{ id: 'p', nom: 'Pharmacie P' }]);

    const res = await service.rechercheGeolocalisee(USER, {});

    expect(res).toEqual({
      centre: null,
      rayonKm: null,
      etablissements: [{ id: 'a', nom: 'Clinique A', latitude: null, longitude: null }],
      pharmacies: [{ id: 'p', nom: 'Pharmacie P' }],
    });
    expect(prisma.etablissementSante.findMany).toHaveBeenCalledWith({
      where: { organisationId: 'org-1', deletedAt: null, statut: 'ACTIF' },
      orderBy: { nom: 'asc' },
    });
    expect(prisma.pharmacie.findMany).toHaveBeenCalledWith({
      where: { organisationId: 'org-1', deletedAt: null, statut: 'ACTIVE' },
      orderBy: { nom: 'asc' },
    });
  });

  it('recherche sans position : cible et limite respectées', async () => {
    identity.getMe.mockResolvedValue(identite(['ADHERENT_TITULAIRE']));
    prisma.pharmacie.findMany.mockResolvedValue([]);

    const res = await service.rechercheGeolocalisee(USER, { cible: 'PHARMACIES', limite: 10 });

    expect(prisma.etablissementSante.findMany).not.toHaveBeenCalled();
    expect(res.etablissements).toBeUndefined();
    expect(prisma.pharmacie.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  // --- Automatisation (v8 §9, PROMPT 15) --------------------------

  it('géocodage automatique : pas de coords fournies, adresse présente → Nominatim résout', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    geocodage.geocoder.mockResolvedValue({ latitude: 5.3599, longitude: -4.0083 });
    prisma.etablissementSante.create.mockResolvedValue({ id: 'e1' });
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e1', nom: 'CHU', statut: 'EN_ATTENTE_VALIDATION' });

    const res = await service.creerEtablissement(USER, {
      nom: 'CHU de Cocody',
      code: 'CHU-C',
      typeEtablissement: 'HOPITAL_PUBLIC',
      ville: 'Abidjan',
      commune: 'Cocody',
    });

    expect(geocodage.geocoder).toHaveBeenCalled();
    expect(prisma.etablissementSante.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ latitude: 5.3599, longitude: -4.0083 }),
      }),
    );
    expect(res.avertissements.some((a: any) => a.type === 'GEOCODAGE_AUTO')).toBe(true);
  });

  it('géocodage : Nominatim ne trouve rien → avertissement, création sans coords (pas de blocage)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    geocodage.geocoder.mockResolvedValue(null);
    prisma.etablissementSante.create.mockResolvedValue({ id: 'e1' });
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e1', nom: 'X', statut: 'EN_ATTENTE_VALIDATION' });

    const res = await service.creerEtablissement(USER, {
      nom: 'Cabinet perdu',
      code: 'CP1',
      typeEtablissement: 'CABINET_MEDICAL',
      ville: 'Nulle part',
    });

    expect(prisma.etablissementSante.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ latitude: null, longitude: null }) }),
    );
    expect(res.avertissements.some((a: any) => a.type === 'GEOCODAGE_ECHOUE')).toBe(true);
  });

  it('détection de doublon : nom proche à moins de 200 m → avertissement (pas un blocage)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findMany.mockResolvedValue([
      { id: 'existant', nom: 'Clinique de la Paix', latitude: 5.35, longitude: -4.0 },
    ]);
    prisma.etablissementSante.create.mockResolvedValue({ id: 'e2' });
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e2', nom: 'Clinique la Paix', statut: 'EN_ATTENTE_VALIDATION' });

    const res = await service.creerEtablissement(USER, {
      nom: 'Clinique la Paix', // très proche de « Clinique de la Paix »
      code: 'CLP2',
      typeEtablissement: 'CLINIQUE_PRIVEE',
      latitude: 5.3501, // ~11 m
      longitude: -4.0,
    });

    expect(prisma.etablissementSante.create).toHaveBeenCalled(); // pas bloqué
    const av = res.avertissements.find((a: any) => a.type === 'DOUBLON_POSSIBLE');
    expect(av).toBeDefined();
    expect((av!.details as any[])[0].id).toBe('existant');
  });

  it('détection de doublon : nom différent → aucun avertissement', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findMany.mockResolvedValue([
      { id: 'existant', nom: 'Laboratoire Bio Plus', latitude: 5.35, longitude: -4.0 },
    ]);
    prisma.etablissementSante.create.mockResolvedValue({ id: 'e3' });
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e3', nom: 'Clinique Sainte Anne', statut: 'EN_ATTENTE_VALIDATION' });

    const res = await service.creerEtablissement(USER, {
      nom: 'Clinique Sainte Anne',
      code: 'CSA1',
      typeEtablissement: 'CLINIQUE_PRIVEE',
      latitude: 5.3501,
      longitude: -4.0,
    });

    expect(res.avertissements.some((a: any) => a.type === 'DOUBLON_POSSIBLE')).toBe(false);
  });

  it('reverifierObsoletes : marque A_REVERIFIER les entrées jamais / trop anciennement vérifiées', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.updateMany.mockResolvedValue({ count: 3 });
    prisma.pharmacie.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.reverifierObsoletes(USER, {});

    expect(prisma.etablissementSante.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { verificationStatut: 'A_REVERIFIER' } }),
    );
    expect(res).toMatchObject({ etablissementsMarques: 3, pharmaciesMarquees: 1, moisMax: 12 });
  });

  it('enregistrerVerification : crée la ligne + met à jour le statut de vérification', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e1', organisationId: 'org-1', nom: 'X' });

    await service.enregistrerVerification(USER, 'etablissement', 'e1', {
      methode: 'APPEL_TELEPHONIQUE',
      statutConfirme: 'ACTIF',
    });

    expect(prisma.verificationEtablissement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ etablissementId: 'e1', methode: 'APPEL_TELEPHONIQUE', statutConfirme: 'ACTIF' }),
      }),
    );
    expect(prisma.etablissementSante.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verificationStatut: 'ACTIF' }) }),
    );
  });

  // --- Tarifs conventionnés (v3 §5) -----------------------------------

  it('creerTarif : crée un tarif conventionné établissement × acte et audite', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e1', organisationId: 'org-1' });
    prisma.referentielActe.findFirst.mockResolvedValue({ id: 'acte-1', libelle: 'Consultation généraliste' });
    prisma.tarifConventionne.findFirst
      .mockResolvedValueOnce(null) // pas de doublon
      .mockResolvedValueOnce({ id: 't1', referentielActe: { code: 'C01', libelle: 'Consultation généraliste' } }); // chargerTarif
    prisma.tarifConventionne.create.mockResolvedValue({ id: 't1' });

    const res = await service.creerTarif(USER, 'etablissement', 'e1', {
      referentielActeId: 'acte-1',
      tarifConvention: 15000,
      dateDebut: '2026-01-01',
    });

    expect(prisma.tarifConventionne.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: 'org-1',
          etablissementId: 'e1',
          pharmacieId: null,
          referentielActeId: 'acte-1',
          tarifConvention: 15000,
        }),
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit
    expect(res.id).toBe('t1');
  });

  it('creerTarif : refuse (404) un acte introuvable dans l’organisation', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e1', organisationId: 'org-1' });
    prisma.referentielActe.findFirst.mockResolvedValue(null);

    await expect(
      service.creerTarif(USER, 'etablissement', 'e1', {
        referentielActeId: 'acte-inconnu',
        tarifConvention: 15000,
        dateDebut: '2026-01-01',
      }),
    ).rejects.toThrow('Acte introuvable dans votre organisation.');
    expect(prisma.tarifConventionne.create).not.toHaveBeenCalled();
  });

  it('creerTarif : refuse (409) un doublon — un tarif existe déjà pour ce couple établissement/acte', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e1', organisationId: 'org-1' });
    prisma.referentielActe.findFirst.mockResolvedValue({ id: 'acte-1', libelle: 'Consultation généraliste' });
    prisma.tarifConventionne.findFirst.mockResolvedValue({ id: 't-existant' });

    await expect(
      service.creerTarif(USER, 'etablissement', 'e1', {
        referentielActeId: 'acte-1',
        tarifConvention: 15000,
        dateDebut: '2026-01-01',
      }),
    ).rejects.toThrow('existe déjà');
    expect(prisma.tarifConventionne.create).not.toHaveBeenCalled();
  });

  it('creerTarif : refuse un rôle non ASSUREUR_INFORMATIQUE', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));

    await expect(
      service.creerTarif(USER, 'etablissement', 'e1', {
        referentielActeId: 'acte-1',
        tarifConvention: 15000,
        dateDebut: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tarifConventionne.create).not.toHaveBeenCalled();
  });

  it('listerTarifs : renvoie les tarifs d’un établissement avec l’acte inclus', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.etablissementSante.findFirst.mockResolvedValue({ id: 'e1', organisationId: 'org-1' });
    prisma.tarifConventionne.findMany.mockResolvedValue([
      { id: 't1', tarifConvention: 15000, referentielActe: { code: 'C01', libelle: 'Consultation' } },
    ]);

    const res = await service.listerTarifs(USER, 'etablissement', 'e1');

    expect(prisma.tarifConventionne.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ etablissementId: 'e1', deletedAt: null }),
      }),
    );
    expect(res).toHaveLength(1);
  });

  it('modifierTarif : met à jour le montant et audite', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.tarifConventionne.findFirst
      .mockResolvedValueOnce({ id: 't1', etablissementId: 'e1' }) // chargerTarifDansPerimetre
      .mockResolvedValueOnce({ id: 't1', referentielActe: { code: 'C01', libelle: 'Consultation' } }); // chargerTarif

    const res = await service.modifierTarif(USER, 'etablissement', 'e1', 't1', {
      tarifConvention: 18000,
    });

    expect(prisma.tarifConventionne.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ tarifConvention: 18000 }),
      }),
    );
    expect(res.id).toBe('t1');
  });

  it('supprimerTarif : soft delete + audite', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE']));
    prisma.tarifConventionne.findFirst.mockResolvedValue({ id: 't1', etablissementId: 'e1' });

    await service.supprimerTarif(USER, 'etablissement', 'e1', 't1');

    expect(prisma.tarifConventionne.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('reverifierObsoletes refusé pour un rôle non habilité', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_EXPLOITATION']));
    await expect(service.reverifierObsoletes(USER, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('RechercheGeoDto — position facultative, lat et lng ensemble', () => {
  const erreurs = async (o: object) =>
    (await validate(plainToInstance(RechercheGeoDto, o))).map((e) => e.property);

  it('sans position : valide', async () => {
    expect(await erreurs({})).toEqual([]);
  });
  it('position complète (query params en chaînes) : valide', async () => {
    expect(await erreurs({ lat: '5.32', lng: '-4.02' })).toEqual([]);
  });
  it('latitude seule → longitude exigée ; hors bornes refusé', async () => {
    expect(await erreurs({ lat: '5.32' })).toEqual(['lng']);
    expect(await erreurs({ lat: '95', lng: '0' })).toEqual(['lat']);
  });
});
