import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import sharp from 'sharp';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { formatImagePdf } from '../common/images.util';
import { MemberCarteService, qrEnPng } from './carte.service';

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

/**
 * Images DESSINÉES sur la 1re page, avec leur position/taille réelles (en pt) :
 * lit le flux de contenu (`q … cm … /Nom Do Q`) et compose les matrices `cm`
 * (translations/échelles uniquement, ce que produit pdf-lib). `px` = taille
 * source de l'image (pour savoir laquelle est le QR, la photo ou le logo).
 */
/** Flux de contenu décodé de la 1re page (opérateurs PDF en clair). */
async function contenuPage(octets: Buffer) {
  const doc = await PDFDocument.load(octets);
  const page = doc.getPage(0);
  const contenu = page.node.Contents();
  const flux = contenu instanceof PDFArray
    ? contenu.asArray().map((r) => doc.context.lookup(r))
    : [doc.context.lookup(page.node.get(PDFName.of('Contents')))];
  const texte = flux
    .map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1') : ''))
    .join('\n');
  return { doc, page, texte };
}

async function dessinsImages(octets: Buffer) {
  const { doc, page, texte } = await contenuPage(octets);
  const ressources = page.node.Resources()!;
  const xobjets = ressources.lookup(PDFName.of('XObject'), PDFDict);
  const dessins: { x: number; y: number; w: number; h: number; px: string; opacite: number }[] = [];
  // Bloc le plus interne `q … /Nom Do Q` : aucune ligne `q`/`Q` entre les deux
  // (sinon on agrégerait les `cm` des rectangles dessinés avant).
  for (const bloc of texte.matchAll(/q\n((?:(?!q\n|Q\n)[^\n]*\n)*?)\/([\w-]+) Do\nQ/g)) {
    let [a, d, e, f] = [1, 1, 0, 0];
    for (const cm of bloc[1].matchAll(/([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g)) {
      const [ca, cd, ce, cf] = cm.slice(1).map(Number);
      [e, f] = [e + a * ce, f + d * cf];
      [a, d] = [a * ca, d * cd];
    }
    const img = doc.context.lookup(xobjets.get(PDFName.of(bloc[2]))) as PDFRawStream;
    const px = `${(img.dict.get(PDFName.of('Width')) as PDFNumber).asNumber()}x${(img.dict.get(PDFName.of('Height')) as PDFNumber).asNumber()}`;
    // Opacité : état graphique `/GS… gs` du bloc → ExtGState /ca (1 si absent).
    const gs = bloc[1].match(/\/([\w-]+) gs/);
    const etat = gs ? ressources.lookup(PDFName.of('ExtGState'), PDFDict).lookup(PDFName.of(gs[1]), PDFDict) : null;
    const opacite = etat ? (etat.get(PDFName.of('ca')) as PDFNumber).asNumber() : 1;
    const r = (v: number) => Math.round(v * 100) / 100;
    dessins.push({ x: r(e), y: r(f), w: r(a), h: r(d), px, opacite });
  }
  return dessins;
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

    it('formatImagePdf : détecte PNG/JPEG par les octets, refuse WEBP et le reste', () => {
      expect(formatImagePdf(pngDe(2, 2))).toBe('png');
      expect(formatImagePdf(JPEG_1X1)).toBe('jpg');
      expect(formatImagePdf(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBeNull();
      expect(formatImagePdf(Buffer.from('pas une image'))).toBeNull();
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

    /** Chaînes de texte du PDF (WinAnsi encodé en hexadécimal par pdf-lib). */
    const textesDuPdf = async () => {
      const { texte } = await contenuPage(pdfTeleverse());
      return [...texte.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1'));
    };

    it('bandeau : téléphone et e-mail de la société juste après « CARTE DE MEMBRE »', async () => {
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT,
        organisation: { nom: 'Assureur Test A', telephoneContact: '+225 27 20 00 00 00', emailContact: 'contact@assureur-a.ci' },
      });
      await service.genererCarteAdherent(USER, 'adh-1');
      const chaines = await textesDuPdf();
      const i = chaines.indexOf('CARTE DE MEMBRE');
      expect(i).toBeGreaterThan(-1);
      expect(chaines[i + 1]).toBe('·  Tél. +225 27 20 00 00 00  ·  contact@assureur-a.ci');
    });

    it('bandeau : seulement les coordonnées renseignées ; aucune → rien après « CARTE DE MEMBRE »', async () => {
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT,
        organisation: { nom: 'Assureur Test A', telephoneContact: null, emailContact: 'contact@assureur-a.ci' },
      });
      await service.genererCarteAdherent(USER, 'adh-1');
      let chaines = await textesDuPdf();
      expect(chaines[chaines.indexOf('CARTE DE MEMBRE') + 1]).toBe('·  contact@assureur-a.ci');

      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT,
        organisation: { nom: 'Assureur Test A', telephoneContact: '  ', emailContact: null },
      });
      fetchMock.mockClear(); // pdfTeleverse() lit le 1er téléversement : on repart de zéro
      await service.genererCarteAdherent(USER, 'adh-1');
      chaines = await textesDuPdf();
      expect(chaines.join('|')).not.toMatch(/·|Tél\./);
    });

    it('bandeau : coordonnées trop longues → l’e-mail ENTIER seul, jamais une adresse tronquée', async () => {
      // 98 caractères : la ligne complète (281 pt à 5 pt) ne tient pas dans les
      // 243 pt disponibles, l'e-mail seul (220 pt) oui.
      const email = 'service.relation.adherents.reseau-de-soins.cote-ivoire.abidjan@assureur-test-a-sante-collective.ci';
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT,
        organisation: { nom: 'Assureur Test A', telephoneContact: '+225 27 20 00 00 00', emailContact: email },
      });
      await service.genererCarteAdherent(USER, 'adh-1');
      const chaines = await textesDuPdf();
      const contact = chaines[chaines.indexOf('CARTE DE MEMBRE') + 1];
      expect(contact).toBe(`·  ${email}`);
      expect(contact).not.toContain('...');
    });

    it('apostrophe typographique conservée (N’Guessan, JUSQU’AU) — jamais supprimée', async () => {
      prisma.adherent.findFirst.mockResolvedValue({ ...ADHERENT, prenom: 'Aya', nom: 'N’Guessan' });
      await service.genererCarteAdherent(USER, 'adh-1');
      const { texte } = await contenuPage(pdfTeleverse());
      // Texte WinAnsi encodé en hexadécimal par pdf-lib : on décode chaque Tj.
      const chaines = [...texte.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) =>
        Buffer.from(m[1], 'hex').toString('latin1'),
      );
      expect(chaines).toEqual(expect.arrayContaining(["Aya N'Guessan", "VALABLE JUSQU'AU"]));
      expect(chaines.join('|')).not.toMatch(/NGuessan|JUSQU AU|JUSQUAU/);
    });
  });

  // --- Mise en page (refonte) + logo de l'organisation -------------------

  describe('mise en page et logo', () => {
    const LOGO_URL = 'https://proj.supabase.co/storage/v1/object/public/logos/org-1/logo-1.png';
    const PHOTO = 'org-1/familles/KONAN-AC-CM0000000099/KONAN-AC-CM0000000099.png';

    /** Storage simulé : photo (bucket privé) et logo (URL publique). */
    const servir = (opts: { photo?: Buffer; logo?: Buffer | 'absent' }) => {
      fetchMock.mockImplementation(async (url: string) => {
        const u = String(url);
        const binaire = (b: Buffer | undefined, ok = true) =>
          ({
            ok,
            status: ok ? 200 : 404,
            arrayBuffer: async () => {
              const x = b ?? Buffer.alloc(0);
              return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
            },
          }) as any;
        if (u.includes('/object/authenticated/photos/')) return binaire(opts.photo, !!opts.photo);
        if (u.startsWith(LOGO_URL)) return binaire(opts.logo === 'absent' ? undefined : opts.logo, opts.logo !== 'absent');
        if (u.includes('/object/sign/')) {
          return { ok: true, json: async () => ({ signedURL: '/object/sign/cartes/x.pdf?token=t' }) } as any;
        }
        return { ok: true, text: async () => '' } as any;
      });
    };
    const pdfTeleverse = (): Buffer =>
      fetchMock.mock.calls.find((c) => String(c[0]).includes('/object/cartes/'))![1].body;
    const adherentAvec = (photoUrl: string | null, logoUrl: string | null) =>
      prisma.adherent.findFirst.mockResolvedValue({
        ...ADHERENT,
        photoUrl,
        organisation: { nom: 'Assureur Test A', logoUrl },
      });

    it('logo avec marges transparentes : rogné en mémoire avant le filigrane et le bandeau', async () => {
      // 200 × 80 transparent, contenu opaque 100 × 40 à (30, 20) : 100 px de marges.
      const logoAvecMarges = await sharp({
        create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{
          input: await sharp({ create: { width: 100, height: 40, channels: 4, background: { r: 40, g: 30, b: 20, alpha: 1 } } }).png().toBuffer(),
          left: 30,
          top: 20,
        }])
        .png()
        .toBuffer();
      adherentAvec(PHOTO, LOGO_URL);
      servir({ photo: pngDe(100, 100), logo: logoAvecMarges });

      await service.genererCarteAdherent(USER, 'adh-1');

      const d = await dessinsImages(pdfTeleverse());
      const logos = d.filter((i) => i.px === '100x40');
      expect(logos).toHaveLength(2); // filigrane + bandeau, tous deux sur l'image rognée
      expect(d.some((i) => i.px === '200x80')).toBe(false);
      // Filigrane : la zone 8,5–214 (205,5 pt) est remplie par le CONTENU du logo.
      const filigrane = logos.find((i) => i.opacite < 1)!;
      expect(filigrane.w).toBeCloseTo(205.5, 5);
      expect(filigrane.x + filigrane.w).toBeCloseTo(214, 5);
    });

    it('logo + photo : photo CARRÉE 112 pt centrée verticalement, QR 52 pt centré en bas, logo en FILIGRANE et dans le BANDEAU', async () => {
      adherentAvec(PHOTO, LOGO_URL);
      servir({ photo: pngDe(100, 100), logo: pngDe(200, 80) });

      await service.genererCarteAdherent(USER, 'adh-1');

      expect(fetchMock.mock.calls.some((c) => String(c[0]) === LOGO_URL)).toBe(true);
      const d = await dessinsImages(pdfTeleverse());
      const qr = d.find((i) => i.px === '240x240')!;
      const photo = d.find((i) => i.px === '100x100')!;
      const logos = d.filter((i) => i.px === '200x80');
      const logo = logos.find((i) => i.opacite < 1)!; // filigrane
      const logoBandeau = logos.find((i) => i.opacite === 1)!;
      // QR : 52 × 52, centré horizontalement ((340 - 52) / 2 = 144), en bas, opaque.
      expect(qr).toMatchObject({ w: 52, h: 52, x: 144, y: 10, opacite: 1 });
      // Photo : carré 112 × 112, bord droit à la marge (x 214–326), centrée
      // verticalement dans le corps 0–174 (y 31–143), opaque.
      expect(photo).toMatchObject({ w: 112, h: 112, x: 214, y: 31, opacite: 1 });
      expect(photo.y + photo.h / 2).toBe(174 / 2);
      expect(photo.x + photo.w).toBe(340 - 14);
      // Logo présent DEUX fois : filigrane + bandeau.
      expect(logos).toHaveLength(2);
      // Bandeau : hauteur 22 pt (proportions conservées → 55 × 22), dans la bande 174–214.
      expect(logoBandeau).toMatchObject({ w: 55, h: 22, x: 14, y: 183 });
      expect(logoBandeau.y).toBeGreaterThanOrEqual(174);
      expect(logoBandeau.y + logoBandeau.h).toBeLessThanOrEqual(214);
      // Filigrane : toute la zone libre À GAUCHE de la photo, de la marge de
      // sécurité (8,5) jusqu'au bord de la photo (214) → 205,5 pt de large
      // (proportions conservées → 205,5 × 82,2), centré verticalement sous le
      // bandeau (0–174), opacité 10 %.
      expect(logo).toMatchObject({ opacite: 0.1 });
      expect(logo.w).toBeCloseTo(205.5, 5);
      expect(logo.h).toBeCloseTo(82.2, 5);
      expect(logo.x).toBeCloseTo(8.5, 5);
      expect(logo.y).toBeCloseTo(45.9, 5);
      expect(logo.y + logo.h / 2).toBeCloseTo(87, 5);
      // À la limite de la photo, jamais dessous (la photo opaque le masquerait).
      expect(logo.x + logo.w).toBeCloseTo(photo.x, 5);
      expect(logo.x + logo.w).toBeLessThanOrEqual(photo.x + 1e-9);
      // Dessiné EN PREMIER : tout le reste (photo, QR, texte) passe par-dessus.
      expect(d[0].px).toBe('200x80');
      const { texte } = await contenuPage(pdfTeleverse());
      const iFiligrane = texte.indexOf(' gs\n');
      expect(iFiligrane).toBeGreaterThan(-1);
      expect(texte.indexOf(' Tj', 0)).toBeGreaterThan(iFiligrane); // 1er texte après le filigrane
      // Aucune image hors de la zone de sécurité d'impression : 3 mm (8,5 pt)
      // de chaque bord — seuls les fonds (bandeau) vont au-delà.
      const SECURITE = 8.5;
      for (const i of d) {
        expect(i.x).toBeGreaterThanOrEqual(SECURITE);
        expect(i.y).toBeGreaterThanOrEqual(SECURITE);
        expect(i.x + i.w).toBeLessThanOrEqual(340 - SECURITE);
        expect(i.y + i.h).toBeLessThanOrEqual(214 - SECURITE);
      }
      // QR et photo ne se chevauchent pas ; la photo reste dans le corps (sous le bandeau).
      expect(qr.x + qr.w <= photo.x || qr.y + qr.h <= photo.y).toBe(true);
      expect(photo.y + photo.h).toBeLessThanOrEqual(174);
    });

    it('SANS logo NI photo : carte générée, QR seul dessiné (même place), aucun appel pour le logo', async () => {
      adherentAvec(null, null);
      servir({});

      const res = await service.genererCarteAdherent(USER, 'adh-1');

      expect(res.url).toContain('/object/sign/');
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/logos/'))).toBe(false);
      // Ni filigrane ni état de transparence : QR seul.
      expect(await dessinsImages(pdfTeleverse())).toEqual([{ x: 144, y: 10, w: 52, h: 52, px: '240x240', opacite: 1 }]);
      expect((await contenuPage(pdfTeleverse())).texte).not.toMatch(/ gs\n/);
    });

    it('photo CARRÉE sans contour : découpe rectangulaire exacte, aucune courbe, aucun trait', async () => {
      adherentAvec(PHOTO, null);
      // Portrait non carré : rogné dans le carré (cover), jamais déformé.
      servir({ photo: pngDe(100, 120) });

      await service.genererCarteAdherent(USER, 'adh-1');

      const { texte } = await contenuPage(pdfTeleverse());
      // Chemin de découpe = le carré 214,31 → 326,143 (coins droits).
      expect(texte).toContain('214 31 m\n326 31 l\n326 143 l\n214 143 l\nh\nW\nn');
      expect(texte).not.toMatch(/ c\n/); // aucune courbe de Bézier (pas d'arrondi)
      expect(texte).not.toMatch(/(^|\n)S\n/); // aucun trait (pas de contour)
      const photo = (await dessinsImages(pdfTeleverse())).find((i) => i.px === '100x120')!;
      expect(photo).toMatchObject({ w: 112, h: 134.4, x: 214 }); // largeur = carré, hauteur rognée
    });

    it.each([
      ['logo absent du bucket (404)', 'absent' as const],
      ['logo dans un format non supporté (WEBP)', Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')],
    ])('%s : carte générée normalement, sans logo', async (_cas, logo) => {
      adherentAvec(null, LOGO_URL);
      servir({ logo });

      await service.genererCarteAdherent(USER, 'adh-1');

      const d = await dessinsImages(pdfTeleverse());
      expect(d.map((i) => i.px)).toEqual(['240x240']);
    });

    it('lot souscripteur : logo téléchargé UNE fois et réutilisé sur chaque page', async () => {
      prisma.adherent.findMany.mockResolvedValue([
        { ...ADHERENT, photoUrl: null, organisation: { nom: 'Assureur Test A', logoUrl: LOGO_URL } },
        { ...ADHERENT, id: 'adh-2', numeroCarte: 'CM-0000000101', photoUrl: null, organisation: { nom: 'Assureur Test A', logoUrl: LOGO_URL } },
      ]);
      servir({ logo: pngDe(200, 80) });

      await service.genererCartesSouscripteur(USER, 'sous-1');

      expect(fetchMock.mock.calls.filter((c) => String(c[0]) === LOGO_URL)).toHaveLength(1);
      const doc = await PDFDocument.load(pdfTeleverse());
      expect(doc.getPageCount()).toBe(2);
      const images = await imagesDuPdf(pdfTeleverse());
      expect(images.filter((i) => i.w === 200 && i.h === 80)).toHaveLength(1);
    });

    it('format carte standard conservé : 340 × 214 pt (ratio ID-1 85,6 × 54 mm)', async () => {
      adherentAvec(null, null);
      servir({});
      await service.genererCarteAdherent(USER, 'adh-1');
      const { width, height } = (await PDFDocument.load(pdfTeleverse())).getPage(0).getSize();
      expect([width, height]).toEqual([340, 214]);
      expect(Math.abs(width / height - 85.6 / 54)).toBeLessThan(0.01);
    });
  });
});
