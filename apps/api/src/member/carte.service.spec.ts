import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { MemberCarteService, formatPhotoPdf, qrEnPng } from './carte.service';

/** Images réellement embarquées dans un PDF : dimensions de chaque XObject
 * /Image, hors masques de transparence (/SMask d'un PNG avec alpha, qui ne sont
 * pas des images distinctes). */
async function imagesDuPdf(octets: Buffer): Promise<{ w: number; h: number }[]> {
  const doc = await PDFDocument.load(octets);
  const images: { ref: string; dict: PDFDict }[] = [];
  const masques = new Set<string>();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict?.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      images.push({ ref: ref.toString(), dict });
      const smask = dict.get(PDFName.of('SMask'));
      if (smask) masques.add(smask.toString());
    }
  }
  return images
    .filter((i) => !masques.has(i.ref))
    .map(({ dict }) => ({
      w: (dict.get(PDFName.of('Width')) as PDFNumber).asNumber(),
      h: (dict.get(PDFName.of('Height')) as PDFNumber).asNumber(),
    }));
}

/** PNG réel de `w`×`h` (pngjs), pour distinguer la photo du QR (240×240). */
function pngDe(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data.fill(180);
  return PNG.sync.write(png);
}

// JPEG 1×1 minimal valide (en-tête SOF lu par pdf-lib).
const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

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
  extra: {
    organisationId?: string | null;
    societeId?: string | null;
    entite?: string | null;
    adherentId?: string | null;
  } = {},
) => ({
  profil: {
    id: 'u1',
    organisationId:
      extra.organisationId === undefined ? 'org-1' : extra.organisationId,
    societeId: extra.societeId ?? null,
    entite: extra.entite ?? null,
    adherentId: extra.adherentId ?? null,
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
      statut: 'ACTIF',
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

  it('carte indisponible pour un adhérent non ACTIF → 409, aucun téléversement', async () => {
    prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT, statut: 'SUSPENDU' });
    await expect(
      service.genererCarteAdherent(USER, 'adh-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Self-service ADHERENT (audit dashboard adhérent) : un adhérent peut
  //  générer SA PROPRE carte, jamais celle d'un autre (même par ID direct).
  // ═══════════════════════════════════════════════════════════════════
  it('ADHERENT_TITULAIRE génère SA PROPRE carte', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], {
        entite: 'ADHERENT',
        adherentId: 'adh-1',
      }),
    );
    const res = await service.genererCarteAdherent(USER, 'adh-1');
    expect(res.numeroCarte).toBe('CM-0000000099');
  });

  it('ADHERENT_TITULAIRE ne peut PAS générer la carte d’un autre adhérent (404, pas de fuite)', async () => {
    identity.getMe.mockResolvedValue(
      identite(['ADHERENT_TITULAIRE'], {
        entite: 'ADHERENT',
        adherentId: 'adh-2',
      }),
    );
    await expect(
      service.genererCarteAdherent(USER, 'adh-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // --- Photo en médaillon ---------------------------------------------

  describe('photo en médaillon', () => {
    const CHEMIN = 'org-1/familles/KONAN-AC-CM0000000099/KONAN-AC-CM0000000099.png';

    /** fetch : photo servie par Storage (ou statut d'erreur), upload + signature OK. */
    const avecPhoto = (reponse: { ok: boolean; status?: number; octets?: Buffer }) => {
      fetchMock.mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/object/authenticated/photos/')) {
          return {
            ok: reponse.ok,
            status: reponse.status ?? 200,
            arrayBuffer: async () => {
              const b = reponse.octets ?? Buffer.alloc(0);
              return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
            },
          } as any;
        }
        if (u.includes('/object/sign/')) {
          return { ok: true, json: async () => ({ signedURL: '/object/sign/cartes/x.pdf?token=t' }) } as any;
        }
        return { ok: true, text: async () => '' } as any;
      });
    };
    const pdfTeleverse = (): Buffer =>
      fetchMock.mock.calls.find((c) => String(c[0]).includes('/object/cartes/'))![1].body;

    it('formatPhotoPdf : détecte PNG/JPEG par les octets, refuse WEBP et le reste', () => {
      expect(formatPhotoPdf(pngDe(2, 2))).toBe('png');
      expect(formatPhotoPdf(JPEG_1X1)).toBe('jpg');
      expect(formatPhotoPdf(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBeNull();
      expect(formatPhotoPdf(Buffer.from('pas une image'))).toBeNull();
    });

    it('adhérent AVEC photo PNG : téléchargée depuis le bucket privé et réellement embarquée dans le PDF', async () => {
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT, photoUrl: CHEMIN });
      avecPhoto({ ok: true, octets: pngDe(40, 60) });

      await service.genererCarteAdherent(USER, 'adh-1');

      const appelPhoto = fetchMock.mock.calls.find((c) => String(c[0]).includes('/object/authenticated/photos/'));
      expect(String(appelPhoto![0])).toBe(`https://proj.supabase.co/storage/v1/object/authenticated/photos/${CHEMIN}`);
      expect(appelPhoto![1].headers.Authorization).toBe('Bearer svc-key');
      const images = await imagesDuPdf(pdfTeleverse());
      expect(images).toEqual(expect.arrayContaining([{ w: 40, h: 60 }, { w: 240, h: 240 }]));
      expect(images).toHaveLength(2);
    });

    it('bénéficiaire AVEC photo JPEG : embarquée aussi', async () => {
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT,
        beneficiaires: [{ ...ADHERENT.beneficiaires[0], photoUrl: 'org-1/familles/X/KONAN-AC-CM0000000100.jpg' }],
      });
      avecPhoto({ ok: true, octets: JPEG_1X1 });

      await service.genererCarteBeneficiaire(USER, 'adh-1', 'ben-1');

      expect(await imagesDuPdf(pdfTeleverse())).toEqual(expect.arrayContaining([{ w: 1, h: 1 }]));
    });

    it('SANS photo : carte générée normalement, QR seul, aucun appel au bucket photos', async () => {
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT, photoUrl: null });

      const res = await service.genererCarteAdherent(USER, 'adh-1');

      expect(res.url).toContain('/object/sign/');
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/photos/'))).toBe(false);
      expect(await imagesDuPdf(pdfTeleverse())).toEqual([{ w: 240, h: 240 }]);
    });

    it.each([
      ['WEBP (non supporté par le PDF)', { ok: true, octets: Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1') }],
      ['objet absent du bucket (404)', { ok: false, status: 404 }],
      ['octets PNG corrompus', { ok: true, octets: Buffer.concat([pngDe(2, 2).subarray(0, 8), Buffer.from('garbage')]) }],
    ])('photo inutilisable — %s : carte générée quand même, silhouette neutre, QR seul', async (_cas, reponse) => {
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT, photoUrl: CHEMIN });
      avecPhoto(reponse);

      const res = await service.genererCarteAdherent(USER, 'adh-1');

      expect(res.url).toContain('/object/sign/');
      expect(await imagesDuPdf(pdfTeleverse())).toEqual([{ w: 240, h: 240 }]);
    });

    it('lot souscripteur : photo de chaque adhérent qui en a une', async () => {
      prisma.adherent.findMany.mockResolvedValue([
        { ...ADHERENT, photoUrl: CHEMIN },
        { ...ADHERENT, id: 'adh-2', numeroCarte: 'CM-0000000101', photoUrl: null },
      ]);
      avecPhoto({ ok: true, octets: pngDe(30, 30) });

      await service.genererCartesSouscripteur(USER, 'sous-1');

      const images = await imagesDuPdf(pdfTeleverse());
      expect(images.filter((i) => i.w === 30)).toHaveLength(1);
    });

    it('nom très long : carte générée sans erreur (texte réduit/tronqué, jamais sous le médaillon)', async () => {
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT,
        prenom: 'Marie-Christelle Adjoua Akissi Aya',
        nom: 'N’Guessan-Kouadio de la Rivière',
      });
      await expect(service.genererCarteAdherent(USER, 'adh-1')).resolves.toBeDefined();
    });
  });
});
