import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContestationService } from './contestation.service';

const USER: AuthenticatedUser = {
  sub: 'u1',
  email: 'armelk01+testunitaire@gmail.com',
  postgresRole: 'authenticated',
  claimRole: null,
  aud: 'authenticated',
  token: 'jwt',
};

function pharmacienConseil() {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'ASSUREUR_PHARMACIEN_CONSEIL', pharmacieId: null, adherentId: null },
    permissions: { roleChain: ['ASSUREUR_PHARMACIEN_CONSEIL'] },
  };
}
function pharmacien(pharmacieId = 'pharm-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'PHARMACIE_PHARMACIEN', pharmacieId, adherentId: null },
    permissions: { roleChain: ['PHARMACIE_PHARMACIEN'] },
  };
}
function pharmacieComptable(pharmacieId = 'pharm-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'PHARMACIE_COMPTABLE', pharmacieId, adherentId: null },
    permissions: { roleChain: ['PHARMACIE_COMPTABLE'] },
  };
}
function caissiere(pharmacieId = 'pharm-1') {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'PHARMACIE_CAISSIERE', pharmacieId, adherentId: null },
    permissions: { roleChain: ['PHARMACIE_CAISSIERE'] },
  };
}
function medecinConseil() {
  return {
    profil: { id: 'u1', organisationId: 'org-1', role: 'ASSUREUR_MEDECIN_CONSEIL', pharmacieId: null, adherentId: null },
    permissions: { roleChain: ['ASSUREUR_MEDECIN_CONSEIL'] },
  };
}

describe('ContestationService', () => {
  let service: ContestationService;
  let prisma: any;
  let identity: { getMe: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    prisma = {
      ordonnance: { findMany: jest.fn().mockResolvedValue([]) },
      ligneOrdonnance: { findFirst: jest.fn() },
      contestationPrescription: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    identity = { getMe: jest.fn() };

    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    fetchMock = jest.fn(async (url: string) => {
      if (String(url).includes('/object/sign/')) {
        return { ok: true, json: async () => ({ signedURL: '/object/sign/contestations/x/y.pdf?token=abc' }) } as any;
      }
      return { ok: true, text: async () => '' } as any;
    });
    global.fetch = fetchMock as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ContestationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: identity },
      ],
    }).compile();
    service = moduleRef.get(ContestationService);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  listerOrdonnancesPourRevue — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL.
  // ═══════════════════════════════════════════════════════════════════════
  describe('listerOrdonnancesPourRevue', () => {
    it('renvoie les ordonnances avec lignes et statut de contestation courant', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.ordonnance.findMany.mockResolvedValue([
        {
          id: 'ord-1',
          statut: 'ACTIVE',
          datePrescription: new Date('2026-09-01'),
          dossier: {
            id: 'dos-1',
            numeroTraitement: 'TRT-1',
            etablissement: { nom: 'FARAH' },
            adherent: { nom: 'Konan', prenom: 'Adjoua' },
            beneficiaire: null,
          },
          lignesOrdonnance: [
            {
              id: 'ligne-1',
              denominationMedicament: 'Paracetamol 500mg',
              posologie: '1cp x3/j',
              quantitePrescrite: 10,
              statut: 'SERVIE',
              pharmacieServante: { nom: 'Pharmacie Centrale' },
              contestations: [{ id: 'contest-1', statut: 'OUVERT' }],
            },
          ],
        },
      ]);

      const res = await service.listerOrdonnancesPourRevue(USER);

      expect(res).toEqual([
        expect.objectContaining({
          id: 'ord-1',
          patient: 'Adjoua Konan',
          etablissement: 'FARAH',
          lignes: [
            expect.objectContaining({
              denominationMedicament: 'Paracetamol 500mg',
              contestation: { id: 'contest-1', statut: 'OUVERT' },
            }),
          ],
        }),
      ]);
    });

    it('rôle non autorisé (médecin conseil) → 403', async () => {
      identity.getMe.mockResolvedValue(medecinConseil());
      await expect(service.listerOrdonnancesPourRevue(USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ordonnance.findMany).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  listerContestations — organisation entière pour le pharmacien conseil,
  //  scopée à SA pharmacie pour le personnel PHARMACIE.
  // ═══════════════════════════════════════════════════════════════════════
  describe('listerContestations', () => {
    it('pharmacien conseil : aucun filtre de pharmacie', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      await service.listerContestations(USER);
      const args = prisma.contestationPrescription.findMany.mock.calls[0][0];
      expect(args.where).not.toHaveProperty('ligneOrdonnance');
    });

    it('personnel pharmacie : filtré sur SA pharmacie via pharmacieServanteId', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      await service.listerContestations(USER);
      const args = prisma.contestationPrescription.findMany.mock.calls[0][0];
      expect(args.where.ligneOrdonnance).toEqual({ pharmacieServanteId: 'pharm-1' });
    });

    it('caissière (non habilitée à répondre) → 403', async () => {
      identity.getMe.mockResolvedValue(caissiere('pharm-1'));
      await expect(service.listerContestations(USER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  ouvrirContestation — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL.
  // ═══════════════════════════════════════════════════════════════════════
  describe('ouvrirContestation', () => {
    const ligneServie = (extra: Record<string, unknown> = {}) => ({
      id: 'ligne-1',
      pharmacieServanteId: 'pharm-1',
      ordonnance: { organisationId: 'org-1' },
      ...extra,
    });

    it('ouvre une contestation sur une ligne déjà servie', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.ligneOrdonnance.findFirst.mockResolvedValue(ligneServie());
      prisma.contestationPrescription.findFirst.mockResolvedValue(null);
      prisma.contestationPrescription.create.mockResolvedValue({ id: 'contest-1', statut: 'OUVERT' });

      const res = await service.ouvrirContestation(USER, {
        ligneOrdonnanceId: 'ligne-1',
        motif: 'Quantité facturée supérieure à la quantité prescrite.',
      });

      expect(prisma.contestationPrescription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ligneOrdonnanceId: 'ligne-1', ouvertParId: 'u1' }),
        }),
      );
      expect(res).toMatchObject({ id: 'contest-1' });
    });

    it('ligne pas encore délivrée (pharmacieServanteId null) → 400', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.ligneOrdonnance.findFirst.mockResolvedValue(ligneServie({ pharmacieServanteId: null }));
      await expect(
        service.ouvrirContestation(USER, { ligneOrdonnanceId: 'ligne-1', motif: 'Motif suffisant ici.' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.contestationPrescription.create).not.toHaveBeenCalled();
    });

    it('contestation déjà OUVERT sur cette ligne → 409', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.ligneOrdonnance.findFirst.mockResolvedValue(ligneServie());
      prisma.contestationPrescription.findFirst.mockResolvedValue({ id: 'contest-0', statut: 'OUVERT' });
      await expect(
        service.ouvrirContestation(USER, { ligneOrdonnanceId: 'ligne-1', motif: 'Motif suffisant ici.' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ligne déjà REJETEE (exclusion définitive) → 409', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.ligneOrdonnance.findFirst.mockResolvedValue(ligneServie());
      prisma.contestationPrescription.findFirst.mockResolvedValue({ id: 'contest-0', statut: 'REJETEE' });
      await expect(
        service.ouvrirContestation(USER, { ligneOrdonnanceId: 'ligne-1', motif: 'Motif suffisant ici.' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('une contestation déjà VALIDEE n’empêche pas d’en ouvrir une nouvelle', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.ligneOrdonnance.findFirst.mockResolvedValue(ligneServie());
      prisma.contestationPrescription.findFirst.mockResolvedValue({ id: 'contest-0', statut: 'VALIDEE' });
      prisma.contestationPrescription.create.mockResolvedValue({ id: 'contest-1', statut: 'OUVERT' });
      await expect(
        service.ouvrirContestation(USER, { ligneOrdonnanceId: 'ligne-1', motif: 'Motif suffisant ici.' }),
      ).resolves.toMatchObject({ id: 'contest-1' });
    });

    it('ligne d’une AUTRE organisation → 404 (pas de fuite)', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.ligneOrdonnance.findFirst.mockResolvedValue(ligneServie({ ordonnance: { organisationId: 'org-AUTRE' } }));
      await expect(
        service.ouvrirContestation(USER, { ligneOrdonnanceId: 'ligne-1', motif: 'Motif suffisant ici.' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rôle non autorisé (exploitation) → 403', async () => {
      identity.getMe.mockResolvedValue({
        profil: { id: 'u1', organisationId: 'org-1', role: 'ASSUREUR_EXPLOITATION', pharmacieId: null, adherentId: null },
        permissions: { roleChain: ['ASSUREUR_EXPLOITATION'] },
      });
      await expect(
        service.ouvrirContestation(USER, { ligneOrdonnanceId: 'ligne-1', motif: 'Motif suffisant ici.' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.ligneOrdonnance.findFirst).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  soumettreJustification — réservé à PHARMACIE_PHARMACIEN/PHARMACIE_COMPTABLE
  //  de LA pharmacie concernée.
  // ═══════════════════════════════════════════════════════════════════════
  describe('soumettreJustification', () => {
    const contestationOuverte = (extra: Record<string, unknown> = {}) => ({
      id: 'contest-1',
      statut: 'OUVERT',
      ligneOrdonnance: { pharmacieServanteId: 'pharm-1' },
      ...extra,
    });
    const fichier = (nom = 'facture.pdf', mimetype = 'application/pdf', size = 1000) => ({
      buffer: Buffer.from('contenu'),
      originalname: nom,
      mimetype,
      size,
    });

    it('le pharmacien de la pharmacie concernée soumet sa justification', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.contestationPrescription.findFirst.mockResolvedValue(contestationOuverte());
      prisma.contestationPrescription.update.mockResolvedValue({ id: 'contest-1', statut: 'JUSTIFICATION_RECUE' });

      const res = await service.soumettreJustification(USER, 'contest-1', 'Quantité conforme, voir facture jointe.', [
        fichier(),
      ]);

      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/object/contestations/'))).toBe(true);
      expect(prisma.contestationPrescription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statut: 'JUSTIFICATION_RECUE' }),
        }),
      );
      expect(res).toMatchObject({ statut: 'JUSTIFICATION_RECUE' });
    });

    it('le comptable de la pharmacie concernée peut aussi soumettre', async () => {
      identity.getMe.mockResolvedValue(pharmacieComptable('pharm-1'));
      prisma.contestationPrescription.findFirst.mockResolvedValue(contestationOuverte());
      prisma.contestationPrescription.update.mockResolvedValue({ id: 'contest-1', statut: 'JUSTIFICATION_RECUE' });
      await expect(
        service.soumettreJustification(USER, 'contest-1', 'Réponse suffisante ici.', []),
      ).resolves.toMatchObject({ statut: 'JUSTIFICATION_RECUE' });
    });

    it('la caissière ne peut pas répondre à une contestation', async () => {
      identity.getMe.mockResolvedValue(caissiere('pharm-1'));
      await expect(
        service.soumettreJustification(USER, 'contest-1', 'Réponse suffisante ici.', []),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.contestationPrescription.findFirst).not.toHaveBeenCalled();
    });

    it('une AUTRE pharmacie que celle concernée → 403', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-2'));
      prisma.contestationPrescription.findFirst.mockResolvedValue(contestationOuverte());
      await expect(
        service.soumettreJustification(USER, 'contest-1', 'Réponse suffisante ici.', []),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.contestationPrescription.update).not.toHaveBeenCalled();
    });

    it('contestation déjà JUSTIFICATION_RECUE → 409 (pas de resoumission)', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.contestationPrescription.findFirst.mockResolvedValue(contestationOuverte({ statut: 'JUSTIFICATION_RECUE' }));
      await expect(
        service.soumettreJustification(USER, 'contest-1', 'Réponse suffisante ici.', []),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('réponse trop courte → 400', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      await expect(service.soumettreJustification(USER, 'contest-1', 'no', [])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.contestationPrescription.findFirst).not.toHaveBeenCalled();
    });

    it('type de fichier non autorisé → 400, aucune mise à jour', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.contestationPrescription.findFirst.mockResolvedValue(contestationOuverte());
      await expect(
        service.soumettreJustification(USER, 'contest-1', 'Réponse suffisante ici.', [
          fichier('malware.exe', 'application/x-msdownload'),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.contestationPrescription.update).not.toHaveBeenCalled();
    });

    it('fichier trop volumineux → 400', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      prisma.contestationPrescription.findFirst.mockResolvedValue(contestationOuverte());
      await expect(
        service.soumettreJustification(USER, 'contest-1', 'Réponse suffisante ici.', [
          fichier('grosse-facture.pdf', 'application/pdf', 20 * 1024 * 1024),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  trancherContestation — réservé EXCLUSIVEMENT à ASSUREUR_PHARMACIEN_CONSEIL.
  // ═══════════════════════════════════════════════════════════════════════
  describe('trancherContestation', () => {
    it('VALIDEE débloque la ligne', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.contestationPrescription.findFirst.mockResolvedValue({ id: 'contest-1', statut: 'JUSTIFICATION_RECUE' });
      prisma.contestationPrescription.update.mockResolvedValue({ id: 'contest-1', statut: 'VALIDEE' });

      const res = await service.trancherContestation(USER, 'contest-1', { decision: 'VALIDEE' });

      expect(prisma.contestationPrescription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statut: 'VALIDEE', traiteParId: 'u1' }),
        }),
      );
      expect(res).toMatchObject({ statut: 'VALIDEE' });
    });

    it('REJETEE exclut définitivement', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.contestationPrescription.findFirst.mockResolvedValue({ id: 'contest-1', statut: 'OUVERT' });
      prisma.contestationPrescription.update.mockResolvedValue({ id: 'contest-1', statut: 'REJETEE' });
      await expect(
        service.trancherContestation(USER, 'contest-1', { decision: 'REJETEE' }),
      ).resolves.toMatchObject({ statut: 'REJETEE' });
    });

    it('contestation déjà tranchée (VALIDEE) → 409', async () => {
      identity.getMe.mockResolvedValue(pharmacienConseil());
      prisma.contestationPrescription.findFirst.mockResolvedValue({ id: 'contest-1', statut: 'VALIDEE' });
      await expect(
        service.trancherContestation(USER, 'contest-1', { decision: 'REJETEE' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.contestationPrescription.update).not.toHaveBeenCalled();
    });

    it('rôle non autorisé (pharmacie) → 403', async () => {
      identity.getMe.mockResolvedValue(pharmacien('pharm-1'));
      await expect(
        service.trancherContestation(USER, 'contest-1', { decision: 'VALIDEE' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.contestationPrescription.findFirst).not.toHaveBeenCalled();
    });
  });
});
