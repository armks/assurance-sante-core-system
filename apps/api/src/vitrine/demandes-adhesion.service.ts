import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_DEMANDES_ADHESION } from './vitrine.types';

/**
 * Consultation des demandes du formulaire « Adhésion » (prisma/sql/064) —
 * ASSUREUR_INFORMATIQUE / ASSUREUR_EXPLOITATION (chaîne de rôles), limitée à
 * l'organisation de l'appelant. L'enregistrement lui-même est fait par
 * `VitrineService.envoyerDemande`, avant l'envoi de l'e-mail.
 */
@Injectable()
export class DemandesAdhesionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async lister(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    const demandes = await this.prisma.demandeAdhesion.findMany({
      where: { organisationId: ctx.organisationId, deletedAt: null },
      orderBy: [{ statut: 'asc' }, { createdAt: 'desc' }], // NOUVEAU avant TRAITE
    });
    return demandes.map((d) => ({
      id: d.id,
      nomSociete: d.nomSociete,
      nombreEstime: d.nombreEstime,
      email: d.email,
      telephone: d.telephone,
      objet: d.objet,
      message: d.message,
      statut: d.statut,
      emailEnvoye: d.emailEnvoye,
      traiteLe: d.traiteLe,
      createdAt: d.createdAt,
    }));
  }

  /** NOUVEAU → TRAITE (définitif), tracé par log_audit. */
  async marquerTraitee(user: AuthenticatedUser, id: string) {
    const ctx = await this.contexte(user);
    const demande = await this.prisma.demandeAdhesion.findFirst({
      where: { id, organisationId: ctx.organisationId, deletedAt: null },
    });
    if (!demande) throw new NotFoundException('Demande introuvable.');
    if (demande.statut === 'TRAITE') {
      throw new ConflictException('Cette demande est déjà marquée traitée.');
    }
    const traiteLe = new Date();
    const maj = await this.prisma.demandeAdhesion.update({
      where: { id },
      data: { statut: 'TRAITE', traitePar: ctx.userId, traiteLe },
    });
    await this.prisma.$executeRaw`
      SELECT log_audit(
        ${'TRAITEMENT_DEMANDE_ADHESION'}::text,
        ${'demandes_adhesion'}::text,
        ${id}::uuid,
        ${ctx.userId}::uuid,
        ${JSON.stringify({ nomSociete: demande.nomSociete, email: demande.email })}::jsonb
      )`;
    return { id: maj.id, statut: maj.statut, traiteLe: maj.traiteLe };
  }

  private async contexte(user: AuthenticatedUser) {
    const { profil, permissions } = await this.identity.getMe(user);
    const roleChain = permissions?.roleChain ?? [];
    if (!roleChain.some((r) => (ROLES_DEMANDES_ADHESION as readonly string[]).includes(r))) {
      throw new ForbiddenException(
        'Les demandes d’adhésion sont réservées à ASSUREUR_INFORMATIQUE et ASSUREUR_EXPLOITATION.',
      );
    }
    if (!profil.organisationId) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    return { userId: profil.id, organisationId: profil.organisationId };
  }
}
