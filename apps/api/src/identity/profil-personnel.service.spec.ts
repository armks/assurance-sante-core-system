import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { ProfilPersonnelService } from './profil-personnel.service';

const USER: AuthenticatedUser = { sub: 'u1', email: 'armelk01+testunitaire@gmail.com', postgresRole: 'authenticated', claimRole: null, aud: 'authenticated', token: 'jwt' };

function service(profil: Record<string, unknown> | null = { organisationId: 'org-1', photoUrl: null }, pris: unknown = null) {
  const prisma = {
    profil: {
      findFirst: jest.fn().mockImplementation(async (a: { where: { pseudo?: unknown } }) => (a.where.pseudo ? pris : profil)),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { svc: new ProfilPersonnelService(prisma as never), prisma };
}

describe('ProfilPersonnelService', () => {
  describe('pseudo', () => {
    it('enregistre un pseudo valide, accents acceptés', async () => {
      const { svc, prisma } = service();
      await expect(svc.modifierPseudo(USER, 'Dr Koné')).resolves.toEqual({ pseudo: 'Dr Koné' });
      expect(prisma.profil.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pseudo: 'Dr Koné' } });
    });

    it('un pseudo vide le retire', async () => {
      const { svc, prisma } = service();
      await expect(svc.modifierPseudo(USER, '  ')).resolves.toEqual({ pseudo: null });
      expect(prisma.profil.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pseudo: null } });
    });

    it.each(['a', '<b>x</b>', 'x'.repeat(31), '-tiret'])('refuse le format invalide %s', async (pseudo) => {
      const { svc, prisma } = service();
      await expect(svc.modifierPseudo(USER, pseudo)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.profil.update).not.toHaveBeenCalled();
    });

    it('refuse un pseudo déjà pris dans l’organisation (409), la recherche ignore la casse', async () => {
      const { svc, prisma } = service(undefined, { id: 'autre' });
      await expect(svc.modifierPseudo(USER, 'Marie')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.profil.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organisationId: 'org-1', pseudo: { equals: 'Marie', mode: 'insensitive' }, id: { not: 'u1' } }) }),
      );
      expect(prisma.profil.update).not.toHaveBeenCalled();
    });

    it('profil introuvable → 404', async () => {
      const { svc } = service(null);
      await expect(svc.modifierPseudo(USER, 'Marie')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('photo', () => {
    const fichier = (over: Record<string, unknown> = {}) => ({ buffer: Buffer.from('x'), originalname: 'p.png', mimetype: 'image/png', size: 10, ...over });

    it('refuse l’absence de fichier, un format non image et une photo trop lourde', async () => {
      const { svc, prisma } = service();
      await expect(svc.televerserPhoto(USER, undefined)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.televerserPhoto(USER, fichier({ mimetype: 'text/plain' }))).rejects.toThrow(/JPEG, PNG, WEBP/);
      await expect(svc.televerserPhoto(USER, fichier({ size: 6 * 1024 * 1024 }))).rejects.toThrow(/volumineuse/);
      expect(prisma.profil.update).not.toHaveBeenCalled();
    });

    it('lecture et suppression sans photo : 404 / rien à supprimer', async () => {
      const { svc } = service({ organisationId: 'org-1', photoUrl: null });
      await expect(svc.urlPhoto(USER)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.supprimerPhoto(USER)).resolves.toEqual({ supprimee: false });
    });
  });
});
