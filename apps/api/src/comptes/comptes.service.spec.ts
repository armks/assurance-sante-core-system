import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { DependancesService } from '../dependances/dependances.service';
import { dependancesDeTest } from '../dependances/dependances.testing';
import { IdentityService } from '../identity/identity.service';
import { SupabaseAdminService } from '../invitations/supabase-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ComptesService } from './comptes.service';

const USER: AuthenticatedUser = { sub: 'info-1', email: 'i@a.ci', postgresRole: 'authenticated', claimRole: null, aud: 'authenticated', token: 'jwt' };
const moi = (roleChain = ['ASSUREUR_INFORMATIQUE'], niveauAcces = 'ADMIN') => ({
  profil: { id: 'info-1', organisationId: 'org-1' },
  permissions: { roleChain, niveauAcces },
});
const CIBLE = { id: 'c-1', organisationId: 'org-1', role: 'ASSUREUR_EXPLOITATION', statut: 'ACTIF', etablissementId: null, pharmacieId: null, societeId: null, revoqueMotif: null, desactiveMotif: null };

describe('ComptesService (ADR-007, lot 4)', () => {
  let service: ComptesService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let dependances: ReturnType<typeof dependancesDeTest>;
  let admin: { definirBlocage: jest.Mock; supprimerUtilisateur: jest.Mock };
  const audits = () => prisma.$executeRaw.mock.calls.filter((c: any[]) => Array.isArray(c[0]) && c[0].join('').includes('log_audit'));

  beforeEach(async () => {
    prisma = {
      profil: { findFirst: jest.fn().mockResolvedValue(CIBLE), update: jest.fn(), updateMany: jest.fn() },
      sousRole: { findUnique: jest.fn() },
      regleProvisioning: { findFirst: jest.fn().mockResolvedValue({ id: 'r1' }) },
      etablissementSante: { findUnique: jest.fn(), findFirst: jest.fn() },
      pharmacie: { findUnique: jest.fn(), findFirst: jest.fn() },
      souscripteur: { findUnique: jest.fn(), findFirst: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn().mockResolvedValue(moi()) };
    dependances = dependancesDeTest();
    admin = { definirBlocage: jest.fn().mockResolvedValue(true), supprimerUtilisateur: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ComptesService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
        { provide: DependancesService, useValue: dependances },
        { provide: SupabaseAdminService, useValue: admin },
      ],
    }).compile();
    service = moduleRef.get(ComptesService);
  });

  describe('révoquer', () => {
    it('garde « archiver » ; statut REVOQUE + audit dans UNE transaction ; PUIS sessions supprimées et compte Auth bloqué (jamais supprimé)', async () => {
      const ordre: string[] = [];
      prisma.$transaction.mockImplementation(async (cb: any) => { ordre.push('tx'); return cb(prisma); });
      prisma.$executeRaw.mockImplementation(async (...a: any[]) => { ordre.push(Array.isArray(a[0]) && a[0].join('').includes('auth.sessions') ? 'sessions' : 'audit'); return 1; });
      admin.definirBlocage.mockImplementation(async () => { ordre.push('ban'); return true; });

      const r = await service.revoquer(USER, 'c-1', 'Départ');

      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'utilisateur', 'c-1', 'archiver');
      expect(prisma.profil.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { statut: 'REVOQUE', revoqueLe: expect.any(Date), revoquePar: 'info-1', revoqueMotif: 'Départ' },
      });
      expect(ordre).toEqual(['tx', 'audit', 'sessions', 'ban']);
      expect(admin.definirBlocage).toHaveBeenCalledWith('c-1', true);
      expect(admin.supprimerUtilisateur).not.toHaveBeenCalled();
      expect(prisma.profil.updateMany).not.toHaveBeenCalled();
      expect(r).toMatchObject({ statut: 'REVOQUE', blocageAuth: true });
      expect(audits()[0][1]).toBe('REVOCATION_COMPTE');
    });

    it('refusé par la garde (auto-révocation, dernier administrateur, niveau supérieur…) : rien n’est écrit, aucun appel Supabase', async () => {
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Révocation impossible : ce compte est le dernier administrateur actif'));
      await expect(service.revoquer(USER, 'c-1')).rejects.toThrow(/dernier administrateur/);
      expect(prisma.profil.update).not.toHaveBeenCalled();
      expect(audits()).toHaveLength(0);
      expect(admin.definirBlocage).not.toHaveBeenCalled();
    });

    it('si le blocage Supabase échoue, le statut REVOQUE (appliqué par l’API et la RLS) reste acquis et l’échec est signalé', async () => {
      admin.definirBlocage.mockResolvedValue(false);
      const r = await service.revoquer(USER, 'c-1');
      expect(prisma.profil.update).toHaveBeenCalled();
      expect(r.blocageAuth).toBe(false);
    });

    it('compte d’une autre organisation : 404 ; rôle non informatique : 403', async () => {
      prisma.profil.findFirst.mockResolvedValue(null);
      await expect(service.revoquer(USER, 'autre')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.profil.findFirst).toHaveBeenCalledWith({ where: { id: 'autre', organisationId: 'org-1', deletedAt: null } });
      identity.getMe.mockResolvedValue(moi(['ASSUREUR_DIRECTION']));
      await expect(service.revoquer(USER, 'c-1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('réactiver', () => {
    it('statut ACTIF, désactivation levée, débloqué côté Auth ; audit avec l’état antérieur', async () => {
      prisma.profil.findFirst.mockResolvedValue({ ...CIBLE, statut: 'REVOQUE', revoqueMotif: 'Départ' });
      await service.reactiver(USER, 'c-1');
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'utilisateur', 'c-1', 'desarchiver');
      expect(prisma.profil.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { statut: 'ACTIF', revoqueLe: null, revoquePar: null, revoqueMotif: null, desactiveLe: null, desactiveMotif: null },
      });
      expect(admin.definirBlocage).toHaveBeenCalledWith('c-1', false);
      expect(JSON.parse(audits()[0][5])).toMatchObject({ etait: 'REVOQUE', motifPrecedent: 'Départ' });
    });

    it('structure encore archivée : 409, compte inchangé', async () => {
      prisma.profil.findFirst.mockResolvedValue({ ...CIBLE, desactiveLe: new Date(), etablissementId: 'e1' });
      prisma.etablissementSante.findUnique.mockResolvedValue({ nom: 'Clinique A', statut: 'RESILIE', deletedAt: null });
      await expect(service.reactiver(USER, 'c-1')).rejects.toThrow(/encore archivé/);
      expect(prisma.profil.update).not.toHaveBeenCalled();
    });
  });

  describe('changer le rôle', () => {
    const roles: Record<string, any> = {
      ASSUREUR_EXPLOITATION: { code: 'ASSUREUR_EXPLOITATION', entiteCode: 'ASSUREUR', niveauAcces: 'MODIFICATION' },
      ASSUREUR_COMPTABLE: { code: 'ASSUREUR_COMPTABLE', entiteCode: 'ASSUREUR', niveauAcces: 'MODIFICATION' },
      ASSUREUR_INFORMATIQUE: { code: 'ASSUREUR_INFORMATIQUE', entiteCode: 'ASSUREUR', niveauAcces: 'ADMIN' },
      PHARMACIE_PHARMACIEN: { code: 'PHARMACIE_PHARMACIEN', entiteCode: 'PHARMACIE', niveauAcces: 'MODIFICATION' },
    };
    beforeEach(() => {
      prisma.sousRole.findUnique.mockImplementation(async ({ where }: any) => roles[where.code] ?? null);
    });

    it('rôle permis par regles_provisioning, même entité : ancien et nouveau tracés, effet via la base', async () => {
      await service.changerRole(USER, 'c-1', 'ASSUREUR_COMPTABLE');
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'utilisateur', 'c-1', 'modifier');
      expect(prisma.regleProvisioning.findFirst).toHaveBeenCalledWith({
        where: { roleCree: 'ASSUREUR_COMPTABLE', deletedAt: null, roleCreateur: { in: ['ASSUREUR_INFORMATIQUE'] } },
      });
      expect(prisma.profil.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { role: 'ASSUREUR_COMPTABLE' } });
      expect(audits()[0][1]).toBe('CHANGEMENT_ROLE');
      expect(JSON.parse(audits()[0][5])).toEqual({ ancienRole: 'ASSUREUR_EXPLOITATION', nouveauRole: 'ASSUREUR_COMPTABLE' });
    });

    it('rôle absent de regles_provisioning → 403 ; rôle inconnu → 400 ; même rôle → 409 ; autre entité → 409 ; niveau supérieur → 403', async () => {
      prisma.regleProvisioning.findFirst.mockResolvedValueOnce(null);
      await expect(service.changerRole(USER, 'c-1', 'ASSUREUR_COMPTABLE')).rejects.toThrow(/règles de provisioning/);
      await expect(service.changerRole(USER, 'c-1', 'ROLE_INCONNU')).rejects.toThrow(/Rôle inconnu/);
      await expect(service.changerRole(USER, 'c-1', 'ASSUREUR_EXPLOITATION')).rejects.toThrow(/déjà ce rôle/);
      await expect(service.changerRole(USER, 'c-1', 'PHARMACIE_PHARMACIEN')).rejects.toThrow(/autre entité/);
      identity.getMe.mockResolvedValue(moi(['ASSUREUR_INFORMATIQUE'], 'MODIFICATION'));
      await expect(service.changerRole(USER, 'c-1', 'ASSUREUR_INFORMATIQUE')).rejects.toThrow(/niveau supérieur/);
      expect(prisma.profil.update).not.toHaveBeenCalled();
    });

    it('refusé par la garde (soi-même, dernier administrateur, révoqué) : rien n’est écrit', async () => {
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Changement de rôle impossible : ce compte est révoqué'));
      await expect(service.changerRole(USER, 'c-1', 'ASSUREUR_COMPTABLE')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.profil.update).not.toHaveBeenCalled();
    });
  });

  describe('supprimer', () => {
    it('garde « supprimer » (aucune référence, aucune ligne d’audit) puis suppression logique + audit ; compte Auth supprimé APRÈS', async () => {
      await service.supprimer(USER, 'c-1');
      expect(dependances.assertPossible).toHaveBeenCalledWith(USER, 'utilisateur', 'c-1', 'supprimer');
      expect(prisma.profil.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { deletedAt: expect.any(Date) } });
      expect(audits()[0][1]).toBe('SUPPRESSION_COMPTE');
      expect(admin.supprimerUtilisateur).toHaveBeenCalledWith('c-1');
    });
    it('compte référencé ou avec historique : 409, ni écriture ni suppression Auth', async () => {
      dependances.assertPossible.mockRejectedValueOnce(new ConflictException('Suppression impossible : 4 lignes d’historique (audit)'));
      await expect(service.supprimer(USER, 'c-1')).rejects.toThrow(/historique/);
      expect(prisma.profil.update).not.toHaveBeenCalled();
      expect(admin.supprimerUtilisateur).not.toHaveBeenCalled();
    });
  });

  describe('« Tout réactiver » : comptes désactivés d’un périmètre désarchivé', () => {
    const DESACTIVES = [
      { id: 'a1', email: 'a1@x.ci', role: 'CENTRE_MEDICAL_ACCUEIL', motif: 'archivage' },
      { id: 'a2', email: 'a2@x.ci', role: 'CENTRE_MEDICAL_MEDECIN', motif: 'archivage' },
    ];
    beforeEach(() => {
      prisma.etablissementSante.findFirst.mockResolvedValue({ nom: 'Clinique A', statut: 'ACTIF' });
      prisma.$queryRaw.mockResolvedValue(DESACTIVES);
    });

    it('liste d’abord les comptes (confirmation), puis les réactive en une transaction avec un audit par compte', async () => {
      const liste = await service.desactivesDuPerimetre(USER, 'etablissement', 'e1');
      expect(liste.map((c) => c.email)).toEqual(['a1@x.ci', 'a2@x.ci']);
      const r = await service.reactiverPerimetre(USER, 'etablissement', 'e1');
      expect(prisma.profil.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] } }, data: { desactiveLe: null, desactiveMotif: null } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(audits()).toHaveLength(2);
      expect(JSON.parse(audits()[0][5])).toMatchObject({ groupee: true });
      expect(r.reactives).toHaveLength(2);
    });

    it('périmètre encore archivé → 409 ; aucun compte désactivé → 409 ; périmètre d’une autre organisation → 404 ; les révoqués ne sont jamais touchés (requête sur statut ACTIF)', async () => {
      prisma.etablissementSante.findFirst.mockResolvedValue({ nom: 'Clinique A', statut: 'RESILIE' });
      await expect(service.reactiverPerimetre(USER, 'etablissement', 'e1')).rejects.toThrow(/encore archivé/);
      prisma.etablissementSante.findFirst.mockResolvedValue({ nom: 'Clinique A', statut: 'ACTIF' });
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(service.reactiverPerimetre(USER, 'etablissement', 'e1')).rejects.toThrow(/Aucun compte désactivé/);
      prisma.etablissementSante.findFirst.mockResolvedValue(null);
      await expect(service.reactiverPerimetre(USER, 'etablissement', 'autre')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.profil.updateMany).not.toHaveBeenCalled();
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0]?.[0] ?? []);
      expect(sql).toContain("p.statut = 'ACTIF'");
    });
  });
});
