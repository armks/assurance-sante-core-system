import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PNG } from 'pngjs';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';
import { OrganisationsService } from './organisations.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'superadmin@plateforme.ci',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

const ORG = 'org-1';
const png = () => {
  const p = new PNG({ width: 4, height: 4 });
  p.data.fill(120);
  return PNG.sync.write(p);
};
const fichier = (buffer: Buffer, mimetype = 'image/png') => ({
  buffer,
  originalname: 'logo.png',
  mimetype,
  size: buffer.length,
});

describe('OrganisationsService — logo de l’organisation', () => {
  let service: OrganisationsService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    prisma = {
      organisation: {
        findFirst: jest.fn().mockResolvedValue({ id: ORG, logoUrl: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    identity = {
      getMe: jest.fn().mockResolvedValue({
        profil: { id: 'u1', role: 'SUPERADMIN_PRINCIPAL' },
        permissions: { roleChain: ['SUPERADMIN_PRINCIPAL'] },
      }),
    };
    fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrganisationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(OrganisationsService);
  });

  it.each([
    ['ASSUREUR_DIRECTION', ['ASSUREUR_DIRECTION']],
    ['ASSUREUR_INFORMATIQUE', ['ASSUREUR_INFORMATIQUE']],
    // Hérite de SUPERADMIN_PRINCIPAL dans sous_roles : refusé quand même (rôle propre).
    ['SUPERADMIN_UTILISATEUR_ADMIN', ['SUPERADMIN_UTILISATEUR_ADMIN', 'SUPERADMIN_PRINCIPAL']],
  ])(
    'réservé EXCLUSIVEMENT à SUPERADMIN_PRINCIPAL : %s → 403, rien téléversé',
    async (role, roleChain) => {
      identity.getMe.mockResolvedValue({ profil: { id: 'u1', role }, permissions: { roleChain } });
      await expect(service.modifierLogoOrganisation(USER, ORG, fichier(png()))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.organisation.update).not.toHaveBeenCalled();
    },
  );

  it('organisation inconnue → 404', async () => {
    prisma.organisation.findFirst.mockResolvedValue(null);
    await expect(service.modifierLogoOrganisation(USER, ORG, fichier(png()))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['aucun fichier', undefined],
    ['WEBP (non imprimable sur la carte)', fichier(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), 'image/webp')],
    ['SVG déguisé en PNG (octets vérifiés, pas le mimetype)', fichier(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')],
    ['plus de 2 Mo', { ...fichier(png()), size: 3 * 1024 * 1024 }],
  ])('refuse %s → 400, rien téléversé', async (_cas, f) => {
    await expect(service.modifierLogoOrganisation(USER, ORG, f as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('téléverse dans le bucket public `logos`, enregistre l’URL publique et trace l’audit', async () => {
    const res = await service.modifierLogoOrganisation(USER, ORG, fichier(png()));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/logos\/org-1\/logo-\d+\.png$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer svc-key');
    expect(init.headers['Content-Type']).toBe('image/png');
    expect(res.logoUrl).toMatch(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/logos\/org-1\/logo-\d+\.png$/);
    expect(prisma.organisation.update).toHaveBeenCalledWith({ where: { id: ORG }, data: { logoUrl: res.logoUrl } });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // pas d'ancien logo → aucune suppression
  });

  it('remplace l’ancien logo : nouveau nom (pas de cache servi), ancien objet supprimé APRÈS la mise à jour', async () => {
    const ancien = 'https://proj.supabase.co/storage/v1/object/public/logos/org-1/logo-1000.png';
    prisma.organisation.findFirst.mockResolvedValue({ id: ORG, logoUrl: ancien });

    const res = await service.modifierLogoOrganisation(USER, ORG, fichier(png()));

    expect(res.logoUrl).not.toBe(ancien);
    const suppression = fetchMock.mock.calls.find(([, i]) => i.method === 'DELETE');
    expect(String(suppression![0])).toBe('https://proj.supabase.co/storage/v1/object/logos');
    expect(JSON.parse(suppression![1].body)).toEqual({ prefixes: ['org-1/logo-1000.png'] });
    const ordreUpdate = prisma.organisation.update.mock.invocationCallOrder[0];
    const ordreDelete = fetchMock.mock.invocationCallOrder[fetchMock.mock.calls.indexOf(suppression!)];
    expect(ordreUpdate).toBeLessThan(ordreDelete);
  });

  it('échec de suppression de l’ancien logo : le nouveau logo reste enregistré (pas d’erreur)', async () => {
    prisma.organisation.findFirst.mockResolvedValue({
      id: ORG,
      logoUrl: 'https://proj.supabase.co/storage/v1/object/public/logos/org-1/logo-1000.png',
    });
    fetchMock
      .mockResolvedValueOnce({ ok: true, text: async () => '' }) // upload
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' }); // delete

    await expect(service.modifierLogoOrganisation(USER, ORG, fichier(png()))).resolves.toHaveProperty('logoUrl');
    expect(prisma.organisation.update).toHaveBeenCalled();
  });
});
