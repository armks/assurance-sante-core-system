import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { NB_MAX_PARTENAIRES_ACTIFS, PartenairesVitrineService } from './partenaires-vitrine.service';

const USER: AuthenticatedUser = { sub: 'u1', email: 'armelk01+testunitaire@gmail.com', postgresRole: 'authenticated', claimRole: null, aud: 'authenticated', token: 'jwt' };
const ORG = '11111111-1111-4111-8111-111111111111';
const profil = (role: string, organisationId: string | null = ORG) => ({ profil: { id: 'u1', role, organisationId }, permissions: { roleChain: [role] } });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const logo = (over: Record<string, unknown> = {}) => ({ buffer: PNG, originalname: 'logo.png', mimetype: 'image/png', size: PNG.length, ...over });
const LIGNE = { id: 'p1', organisationId: ORG, nom: 'Clinique Test', logoUrl: 'https://projet.supabase.co/storage/v1/object/public/evenements/' + ORG + '/partenaires/p1-1.png', siteUrl: null, ordreAffichage: 0, actif: true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null };

describe('PartenairesVitrineService', () => {
  let svc: PartenairesVitrineService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://projet.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-service';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => '' } as Response);
    prisma = {
      organisation: { findFirst: jest.fn().mockResolvedValue({ id: ORG }) },
      partenaireVitrine: {
        findMany: jest.fn().mockResolvedValue([LIGNE]),
        findFirst: jest.fn().mockResolvedValue(LIGNE),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ ...LIGNE, ...data })),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...LIGNE, ...data })),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn().mockResolvedValue(profil('ASSUREUR_INFORMATIQUE')) };
    svc = new PartenairesVitrineService(prisma as never, identity as never);
  });
  afterEach(() => fetchSpy.mockRestore());

  describe('droits', () => {
    it.each(['ASSUREUR_INFORMATIQUE_ADJOINT', 'ASSUREUR_DIRECTION', 'ASSUREUR_MEDECIN_CONSEIL', 'CENTRE_MEDICAL_ACCUEIL', 'SUPERADMIN_PRINCIPAL'])('%s : gestion refusée (403), rien d’écrit', async (role) => {
      identity.getMe.mockResolvedValue(profil(role));
      await expect(svc.lister(USER)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.creer(USER, { nom: 'X partenaire' }, logo())).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.modifier(USER, 'p1', { nom: 'Autre nom' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.supprimer(USER, 'p1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.partenaireVitrine.create).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('chaque société ne voit et ne modifie que SES logos (filtre par organisation)', async () => {
      await svc.lister(USER);
      expect(prisma.partenaireVitrine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organisationId: ORG, deletedAt: null } }));
      prisma.partenaireVitrine.findFirst.mockResolvedValue(null); // logo d'une autre société
      await expect(svc.modifier(USER, 'p-autre', { nom: 'Pirate' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.supprimer(USER, 'p-autre')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.partenaireVitrine.findFirst).toHaveBeenCalledWith({ where: { id: 'p-autre', organisationId: ORG, deletedAt: null } });
      expect(prisma.partenaireVitrine.update).not.toHaveBeenCalled();
    });
  });

  describe('ajout', () => {
    it('crée le partenaire : logo téléversé sous {organisation}/partenaires/, URL publique, audit', async () => {
      const r = await svc.creer(USER, { nom: 'Clinique Horizon', siteUrl: 'https://horizon.example', ordreAffichage: 2 }, logo());
      const data = prisma.partenaireVitrine.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ organisationId: ORG, nom: 'Clinique Horizon', siteUrl: 'https://horizon.example', ordreAffichage: 2, actif: true });
      expect(data.logoUrl).toMatch(new RegExp('^https://projet\\.supabase\\.co/storage/v1/object/public/evenements/' + ORG + '/partenaires/.+\\.png$'));
      expect(fetchSpy.mock.calls[0][0]).toContain('/storage/v1/object/evenements/' + ORG + '/partenaires/');
      expect(fetchSpy.mock.calls[0][1].headers['Content-Type']).toBe('image/png');
      expect(prisma.$executeRaw).toHaveBeenCalled(); // log_audit
      expect(r.nom).toBe('Clinique Horizon');
    });

    it('exige un logo ; refuse un fichier qui n’est pas JPEG / PNG / WEBP (SVG, HTML déguisé) et un logo trop lourd', async () => {
      await expect(svc.creer(USER, { nom: 'Sans logo' })).rejects.toBeInstanceOf(BadRequestException);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      await expect(svc.creer(USER, { nom: 'Faux logo' }, logo({ buffer: svg, size: svg.length, mimetype: 'image/png', originalname: 'x.png' }))).rejects.toThrow(/JPEG, PNG, WEBP/);
      await expect(svc.creer(USER, { nom: 'Trop lourd' }, logo({ size: 6 * 1024 * 1024 }))).rejects.toThrow(/volumineux/);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(prisma.partenaireVitrine.create).not.toHaveBeenCalled();
    });

    it(`plafonne à ${NB_MAX_PARTENAIRES_ACTIFS} logos actifs`, async () => {
      prisma.partenaireVitrine.count.mockResolvedValue(NB_MAX_PARTENAIRES_ACTIFS);
      await expect(svc.creer(USER, { nom: 'Le trente-et-unième' }, logo())).rejects.toThrow(/logos actifs/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('si la base refuse la création, le logo téléversé est retiré du bucket (pas d’image publique orpheline)', async () => {
      prisma.partenaireVitrine.create.mockRejectedValue(new Error('échec base'));
      await expect(svc.creer(USER, { nom: 'Clinique X' }, logo())).rejects.toThrow('échec base');
      expect(fetchSpy.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true);
    });
  });

  describe('modification et suppression', () => {
    it('remplace le logo : le nouveau est téléversé, l’ancien supprimé du bucket après validation', async () => {
      await svc.modifier(USER, 'p1', { nom: 'Nouveau nom' }, logo());
      const appels = fetchSpy.mock.calls.map((c) => c[1]?.method);
      expect(appels).toEqual(['POST', 'DELETE']);
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body).prefixes[0]).toBe(ORG + '/partenaires/p1-1.png');
    });

    it('réactiver un logo archivé respecte le plafond', async () => {
      prisma.partenaireVitrine.findFirst.mockResolvedValue({ ...LIGNE, actif: false });
      prisma.partenaireVitrine.count.mockResolvedValue(NB_MAX_PARTENAIRES_ACTIFS);
      await expect(svc.modifier(USER, 'p1', { actif: true })).rejects.toThrow(/logos actifs/);
    });

    it('supprime logiquement (jamais physiquement) et retire le logo du bucket', async () => {
      await expect(svc.supprimer(USER, 'p1')).resolves.toEqual({ ok: true });
      expect(prisma.partenaireVitrine.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: expect.objectContaining({ actif: false, deletedAt: expect.any(Date) }) });
      expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  describe('lecture publique', () => {
    it('page d’une société : seulement SES logos actifs non supprimés, sans champ interne', async () => {
      prisma.partenaireVitrine.findMany.mockResolvedValue([LIGNE]);
      const r = await svc.publics('1.2.3.4', 'assureur-test-a');
      expect(prisma.organisation.findFirst).toHaveBeenCalledWith({ where: { slug: 'assureur-test-a', deletedAt: null, statut: 'ACTIVE' }, select: { id: true } });
      expect(prisma.partenaireVitrine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organisationId: ORG, actif: true, deletedAt: null }, take: NB_MAX_PARTENAIRES_ACTIFS }));
      expect(r).toEqual([{ id: 'p1', nom: 'Clinique Test', logoUrl: LIGNE.logoUrl, siteUrl: null }]);
    });

    it('société inconnue ou suspendue : liste vide, jamais les logos d’une autre organisation', async () => {
      prisma.organisation.findFirst.mockResolvedValue(null);
      await expect(svc.publics('1.2.3.4', 'inconnue')).resolves.toEqual([]);
      expect(prisma.partenaireVitrine.findMany).not.toHaveBeenCalled();
    });

    it('page principale : organisation vitrine ; variable absente ou invalide → liste vide', async () => {
      process.env.VITRINE_ORGANISATION_ID = ORG;
      await svc.publics('1.2.3.4');
      expect(prisma.partenaireVitrine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organisationId: ORG }) }));
      prisma.partenaireVitrine.findMany.mockClear();
      process.env.VITRINE_ORGANISATION_ID = 'pas-un-uuid';
      await expect(svc.publics('1.2.3.4')).resolves.toEqual([]);
      delete process.env.VITRINE_ORGANISATION_ID;
      await expect(svc.publics('1.2.3.4')).resolves.toEqual([]);
      expect(prisma.partenaireVitrine.findMany).not.toHaveBeenCalled();
    });
  });
});
