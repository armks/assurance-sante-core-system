import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreerEvenementDto } from './dto/evenement.dto';
import {
  EvenementsService,
  formatImageEvenement,
  selectionPublique,
  statutEvenement,
  type FichierImage,
} from './evenements.service';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';

/** Garde des dépendances (ADR-007) : tout est possible par défaut. */
let dependances: ReturnType<typeof dependancesDeTest>;
beforeEach(() => {
  dependances = dependancesDeTest();
});

const USER = { id: 'u-1', email: 'it@assureur.ci' } as unknown as AuthenticatedUser;
const ORG = '11111111-1111-4111-8111-111111111111';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const image = (buffer = JPEG, size = buffer.length): FichierImage => ({
  buffer,
  size,
  originalname: 'affiche.jpg',
  mimetype: 'image/jpeg',
});
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('EvenementsService', () => {
  let service: EvenementsService;
  let prisma: {
    evenement: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    organisation: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let identity: { getMe: jest.Mock };
  let fetchMock: jest.Mock;
  const role = (r: string, organisationId: string | null = ORG) =>
    identity.getMe.mockResolvedValue({ profil: { id: 'u-1', role: r, organisationId }, permissions: {} });

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://projet.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service-test';
    delete process.env.VITRINE_ORGANISATION_ID;
    prisma = {
      evenement: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...ligne(), ...data })),
      },
      organisation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ heroTitre: null, heroSousTitre: null, heroImageUrl: null }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ heroTitre: null, heroSousTitre: null, heroImageUrl: null, ...data }),
        ),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      // écritures + audit dans une même transaction (ADR-007)
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };
    fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;
    const moduleRef = await Test.createTestingModule({
      providers: [
        EvenementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: DependancesService, useValue: dependances },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(EvenementsService);
    jest.spyOn(service, 'maintenant').mockReturnValue(new Date('2026-09-30T10:00:00Z'));
  });

  const ligne = (o: Partial<Record<string, unknown>> = {}) => ({
    id: 'e-1',
    organisationId: ORG,
    titre: 'Journée santé',
    description: null,
    imageUrl: 'https://projet.supabase.co/storage/v1/object/public/evenements/org/e-1-1.jpg',
    dateEvenement: d('2026-10-15'),
    ordreAffichage: 0,
    actif: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...o,
  });

  it.each(['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE_ADJOINT', 'ASSUREUR_DIRECTION', 'ADHERENT_TITULAIRE'])(
    'rôle %s → 403, rien n’est téléversé ni écrit',
    async (r) => {
      role(r);
      await expect(
        service.creer(USER, { titre: 'X', dateEvenement: '2026-10-01' }, image()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.lister(USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.evenement.create).not.toHaveBeenCalled();
    },
  );

  it('création : image JPEG téléversée dans le bucket public, URL publique enregistrée, audit', async () => {
    role('ASSUREUR_INFORMATIQUE');
    const res = await service.creer(
      USER,
      { titre: 'Journée santé', dateEvenement: '2026-10-15', ordreAffichage: 2, actif: true },
      image(),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`^https://projet\\.supabase\\.co/storage/v1/object/evenements/${ORG}/[0-9a-f-]{36}-\\d+\\.jpg$`));
    expect(init.headers['Content-Type']).toBe('image/jpeg');
    const data = prisma.evenement.create.mock.calls[0][0].data;
    expect(data.organisationId).toBe(ORG);
    expect(data.imageUrl).toMatch(/\/storage\/v1\/object\/public\/evenements\//);
    expect(res.statut).toBe('A_VENIR');
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('création sans image → 400 ; contenu non image (déclaré image/jpeg) → 400', async () => {
    role('ASSUREUR_INFORMATIQUE');
    await expect(service.creer(USER, { titre: 'X', dateEvenement: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await expect(service.creer(USER, { titre: 'X', dateEvenement: '2026-10-01' }, image(svg))).rejects.toThrow(
      'Formats d’image acceptés',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('échec en base après téléversement → l’image est supprimée du bucket (pas d’orpheline publique)', async () => {
    role('ASSUREUR_INFORMATIQUE');
    prisma.evenement.create.mockRejectedValue(new Error('boom'));
    await expect(service.creer(USER, { titre: 'X', dateEvenement: '2026-10-01' }, image())).rejects.toThrow('boom');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('modification / suppression d’un événement d’une autre organisation → 404', async () => {
    role('ASSUREUR_INFORMATIQUE');
    prisma.evenement.findFirst.mockResolvedValue(null);
    await expect(service.modifier(USER, 'e-x', { titre: 'Y' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.supprimer(USER, 'e-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.evenement.findFirst).toHaveBeenCalledWith({ where: { id: 'e-x', organisationId: ORG, deletedAt: null } });
  });

  it('suppression : logique (deletedAt + inactif) et image retirée du bucket', async () => {
    role('ASSUREUR_INFORMATIQUE');
    prisma.evenement.findFirst.mockResolvedValue(ligne());
    await service.supprimer(USER, 'e-1');
    expect(prisma.evenement.update).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      data: { deletedAt: expect.any(Date), actif: false },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prefixes: ['org/e-1-1.jpg'] });
  });

  it('suppression : contrôle des dépendances, puis mise à jour ET audit dans la MÊME transaction ; image effacée après validation', async () => {
    role('ASSUREUR_INFORMATIQUE');
    prisma.evenement.findFirst.mockResolvedValue(ligne());
    const ordre: string[] = [];
    prisma.$transaction.mockImplementation(async (cb: any) => {
      ordre.push('debut-transaction');
      const r = await cb(prisma);
      ordre.push('fin-transaction');
      return r;
    });
    prisma.evenement.update.mockImplementation(async () => ordre.push('update'));
    prisma.$executeRaw.mockImplementation(async () => ordre.push('audit'));
    fetchMock.mockImplementation(async () => {
      ordre.push('stockage');
      return { ok: true, json: async () => [] };
    });

    await service.supprimer(USER, 'e-1');

    expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'evenement', 'e-1', 'supprimer');
    expect(ordre).toEqual(['debut-transaction', 'update', 'audit', 'fin-transaction', 'stockage']);
  });

  it('suppression : échec de la transaction → aucune ligne d’audit validée et image CONSERVÉE', async () => {
    role('ASSUREUR_INFORMATIQUE');
    prisma.evenement.findFirst.mockResolvedValue(ligne());
    prisma.$transaction.mockRejectedValueOnce(new Error('base indisponible'));

    await expect(service.supprimer(USER, 'e-1')).rejects.toThrow('base indisponible');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suppression refusée par la garde des dépendances (409) → rien n’est écrit', async () => {
    role('ASSUREUR_INFORMATIQUE');
    prisma.evenement.findFirst.mockResolvedValue(ligne());
    dependances.assertPossible.mockRejectedValueOnce(new Error('409'));

    await expect(service.supprimer(USER, 'e-1')).rejects.toThrow('409');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('public : VITRINE_ORGANISATION_ID absente ou invalide → liste vide, aucune requête', async () => {
    expect(await service.publics('1.1.1.1')).toEqual([]);
    process.env.VITRINE_ORGANISATION_ID = 'pas-un-uuid';
    expect(await service.publics('1.1.1.1')).toEqual([]);
    expect(prisma.evenement.findMany).not.toHaveBeenCalled();
  });

  it('public : filtre organisation vitrine + actif + non supprimé ; champs publics seulement', async () => {
    process.env.VITRINE_ORGANISATION_ID = ORG;
    prisma.evenement.findMany.mockResolvedValue([ligne()]);
    const res = await service.publics('1.1.1.2');
    expect(prisma.evenement.findMany).toHaveBeenCalledWith({ where: { organisationId: ORG, actif: true, deletedAt: null } });
    expect(Object.keys(res[0]).sort()).toEqual(['dateEvenement', 'description', 'id', 'imageUrl', 'statut', 'titre']);
  });

  it('page d’une société : ses événements uniquement, jamais ceux de l’organisation vitrine', async () => {
    process.env.VITRINE_ORGANISATION_ID = ORG;
    const AUTRE = '22222222-2222-4222-8222-222222222222';
    prisma.organisation.findFirst.mockResolvedValue({ id: AUTRE });
    await service.publics('1.1.1.4', 'mutuelle-abidjan');
    expect(prisma.organisation.findFirst).toHaveBeenCalledWith({
      where: { slug: 'mutuelle-abidjan', deletedAt: null, statut: 'ACTIVE' },
      select: { id: true },
    });
    expect(prisma.evenement.findMany).toHaveBeenCalledWith({ where: { organisationId: AUTRE, actif: true, deletedAt: null } });
  });

  it('slug inconnu → liste vide (pas de repli sur l’organisation vitrine)', async () => {
    process.env.VITRINE_ORGANISATION_ID = ORG;
    expect(await service.publics('1.1.1.5', 'inconnue')).toEqual([]);
    expect(prisma.evenement.findMany).not.toHaveBeenCalled();
  });

  it('bannière : ASSUREUR_COMPTABLE / adjoint → 403, rien écrit', async () => {
    for (const r of ['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE_ADJOINT']) {
      role(r);
      await expect(service.modifierHero(USER, { heroTitre: 'X' })).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.organisation.update).not.toHaveBeenCalled();
  });

  it('bannière : textes et image enregistrés sur SA société, ancienne image supprimée, audit', async () => {
    role('ASSUREUR_INFORMATIQUE');
    prisma.organisation.findUnique.mockResolvedValue({
      heroTitre: null,
      heroSousTitre: null,
      heroImageUrl: 'https://projet.supabase.co/storage/v1/object/public/evenements/org/hero-1.jpg',
    });
    const res = await service.modifierHero(USER, { heroTitre: 'Votre santé, notre engagement', heroSousTitre: null }, image());
    const data = prisma.organisation.update.mock.calls[0][0];
    expect(data.where).toEqual({ id: ORG });
    expect(data.data.heroTitre).toBe('Votre santé, notre engagement');
    expect(data.data.heroSousTitre).toBeNull();
    expect(data.data.heroImageUrl).toMatch(new RegExp(`/object/public/evenements/${ORG}/hero-\\d+\\.jpg$`));
    expect(res.heroTitre).toBe('Votre santé, notre engagement');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ prefixes: ['org/hero-1.jpg'] });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('bannière : retrait de l’image → null (image par défaut), champs absents inchangés', async () => {
    role('ASSUREUR_INFORMATIQUE');
    await service.modifierHero(USER, { supprimerImage: true });
    expect(prisma.organisation.update.mock.calls[0][0].data).toEqual({ heroImageUrl: null });
  });

  it('public : 60 lectures par IP, la 61e → 429', async () => {
    for (let i = 0; i < 60; i++) await service.publics('1.1.1.3');
    const err = await service.publics('1.1.1.3').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
  });
});

describe('Règles pures', () => {
  const now = new Date('2026-09-30T10:00:00Z');

  it('statut : jour même = à venir, veille = passé', () => {
    expect(statutEvenement(d('2026-09-30'), now)).toBe('A_VENIR');
    expect(statutEvenement(d('2026-09-29'), now)).toBe('PASSE');
  });

  it('sélection : ordre d’affichage, puis à venir (plus proche) avant passés (plus récent), 5 au plus', () => {
    const e = (id: string, ordre: number, date: string) => ({ id, ordreAffichage: ordre, dateEvenement: d(date) });
    const res = selectionPublique(
      [
        e('passe-recent', 1, '2026-09-20'),
        e('avenir-loin', 1, '2026-12-01'),
        e('avenir-proche', 1, '2026-10-02'),
        e('passe-ancien', 1, '2026-01-10'),
        e('prioritaire', 0, '2025-05-01'),
        e('ordre-5', 5, '2026-10-01'),
        e('ordre-9', 9, '2026-10-01'),
      ],
      now,
    ).map((x) => x.id);
    expect(res).toEqual(['prioritaire', 'avenir-proche', 'avenir-loin', 'passe-recent', 'passe-ancien']);
  });

  it('format d’après les octets : JPEG, PNG, WEBP ; SVG / texte refusés', () => {
    expect(formatImageEvenement(JPEG)?.mime).toBe('image/jpeg');
    expect(formatImageEvenement(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext).toBe('png');
    expect(formatImageEvenement(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary'))?.ext).toBe('webp');
    expect(formatImageEvenement(Buffer.from('<svg/>'))).toBeNull();
  });

  it('DTO multipart : actif "false" → false, ordre "3" → 3, date stricte', async () => {
    const dto = plainToInstance(CreerEvenementDto, { titre: 'Forum', dateEvenement: '2026-10-01', actif: 'false', ordreAffichage: '3' });
    expect(await validate(dto)).toEqual([]);
    expect(dto.actif).toBe(false);
    expect(dto.ordreAffichage).toBe(3);
    const mauvais = plainToInstance(CreerEvenementDto, { titre: 'Forum', dateEvenement: '01/10/2026' });
    expect((await validate(mauvais)).map((x) => x.property)).toEqual(['dateEvenement']);
  });
});
