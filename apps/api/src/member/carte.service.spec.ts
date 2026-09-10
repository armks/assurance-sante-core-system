import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberCarteService, qrEnPng } from './carte.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'info@assureur.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const identite = (
  roleChain: string[],
  extra: { organisationId?: string | null; societeId?: string | null } = {},
) => ({
  profil: {
    id: 'u1',
    organisationId:
      extra.organisationId === undefined ? 'org-1' : extra.organisationId,
    societeId: extra.societeId ?? null,
  },
  permissions: roleChain.length ? { roleChain } : null,
});

const ADHERENT = {
  id: 'adh-1',
  organisationId: 'org-1',
  souscripteurId: 'sous-1',
  numeroAdherent: 'ADH-2026-000009',
  numeroCarte: 'CM-0000000099',
  nom: 'Konan',
  prenom: 'Adjoua',
  statut: 'ACTIF',
  organisation: { nom: 'Assureur Test A' },
  souscripteur: { nom: 'ACME BTP' },
  police: {
    dateFin: new Date('2026-12-31'),
    produit: { nom: 'Formule Essentielle', version: 2 },
  },
  beneficiaires: [
    {
      id: 'ben-1',
      numeroCarte: 'CM-0000000100',
      nom: 'Konan',
      prenom: 'Yao',
      lienParente: 'ENFANT',
    },
  ],
};

describe('MemberCarteService — cartes de membre (PDF + QR + storage)', () => {
  let service: MemberCarteService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    prisma = {
      adherent: {
        findFirst: jest.fn().mockResolvedValue(ADHERENT),
        findMany: jest.fn().mockResolvedValue([ADHERENT, { ...ADHERENT, id: 'adh-2', numeroCarte: 'CM-0000000101' }]),
      },
      souscripteur: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sous-1', organisationId: 'org-1', deletedAt: null }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    identity = {
      getMe: jest.fn().mockResolvedValue(identite(['ASSUREUR_INFORMATIQUE'])),
    };

    fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('/object/sign/')) {
        return {
          ok: true,
          json: async () => ({ signedURL: '/object/sign/cartes/x/y.pdf?token=abc' }),
        } as any;
      }
      return { ok: true, text: async () => '' } as any;
    });
    global.fetch = fetchMock as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        MemberCarteService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(MemberCarteService);
  });

  it('qrEnPng produit un QR PNG décodable qui encode exactement le contenu', async () => {
    const png = await qrEnPng('CM-0000000099');
    const img = PNG.sync.read(png);
    const decoded = jsQR(
      Uint8ClampedArray.from(img.data),
      img.width,
      img.height,
    );
    expect(decoded?.data).toBe('CM-0000000099');
  });

  it('génère la carte d’un adhérent : PDF téléversé, URL signée, QR = numero_carte', async () => {
    const res = await service.genererCarteAdherent(USER, 'adh-1');

    // 2 appels réseau : upload puis signature
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/object/cartes/'))).toBe(true);
    expect(urls.some((u) => u.includes('/object/sign/cartes/'))).toBe(true);

    // le PDF téléversé commence bien par %PDF
    const uploadCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/object/cartes/'),
    )!;
    const body: Buffer = uploadCall[1].body;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    expect(res.url).toContain('/storage/v1/object/sign/cartes/');
    expect(res.numeroCarte).toBe('CM-0000000099');
    expect(res.qrCode).toMatch(/^data:image\/png;base64,/);

    // le QR renvoyé est lisible et encode le numero_carte
    const qrBuf = Buffer.from(res.qrCode.split(',')[1], 'base64');
    const img = PNG.sync.read(qrBuf);
    const decoded = jsQR(Uint8ClampedArray.from(img.data), img.width, img.height);
    expect(decoded?.data).toBe('CM-0000000099');

    expect(prisma.$executeRaw).toHaveBeenCalled(); // audit
  });

  it('génère un lot pour un souscripteur : un PDF multi-pages, nombreCartes correct', async () => {
    const res = await service.genererCartesSouscripteur(USER, 'sous-1');
    expect(res.nombreCartes).toBe(2);
    const uploadCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/object/cartes/'),
    )!;
    const body: Buffer = uploadCall[1].body;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('lot vide → 404 (rien à générer)', async () => {
    prisma.adherent.findMany.mockResolvedValue([]);
    await expect(
      service.genererCartesSouscripteur(USER, 'sous-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse un rôle non habilité (comptable)', async () => {
    identity.getMe.mockResolvedValue(identite(['ASSUREUR_COMPTABLE']));
    await expect(
      service.genererCarteAdherent(USER, 'adh-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('génère la carte d’un bénéficiaire (QR = sa propre carte)', async () => {
    const res = await service.genererCarteBeneficiaire(USER, 'adh-1', 'ben-1');
    expect(res.numeroCarte).toBe('CM-0000000100');
    const qrBuf = Buffer.from(res.qrCode.split(',')[1], 'base64');
    const img = PNG.sync.read(qrBuf);
    const decoded = jsQR(Uint8ClampedArray.from(img.data), img.width, img.height);
    expect(decoded?.data).toBe('CM-0000000100');
  });
});
