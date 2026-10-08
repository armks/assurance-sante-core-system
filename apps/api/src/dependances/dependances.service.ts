import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIONS,
  type Action,
  type ContexteDependances,
  type DefinitionEntite,
  type LienCompte,
  type Verdict,
} from './dependances.types';
import { REGISTRE } from './registre';

const NOM_ACTION: Record<Action, string> = {
  supprimer: 'Suppression',
  archiver: 'Archivage',
  desarchiver: 'Désarchivage',
  modifier: 'Modification',
};

/** « 3 polices et 1 cotisation », « 2 adhérents, 1 police et 4 cotisations ». */
export function enumerer(liens: LienCompte[]): string {
  const morceaux = liens.map((l) => `${l.nombre} ${l.libelle}`);
  return morceaux.length <= 1
    ? (morceaux[0] ?? '')
    : `${morceaux.slice(0, -1).join(', ')} et ${morceaux[morceaux.length - 1]}`;
}

/**
 * Service commun « action possible ? » (ADR-007) — suppression, archivage,
 * désarchivage, modification. Compte les liens d'un enregistrement (clés étrangères ET
 * liens logiques), TOUJOURS dans le périmètre du jeton : organisation de l'appelant,
 * et sa propre société pour un rôle société. Un enregistrement hors périmètre est
 * introuvable (404), jamais compté.
 *
 * `assertPossible` est appelé par les services métier AVANT toute écriture : refus →
 * 409 avec la raison et les nombres, tracé dans l'audit HORS transaction (le refus doit
 * survivre au rollback). Les actions réussies restent journalisées par le service
 * métier, dans SA transaction.
 */
@Injectable()
export class DependancesService {
  private readonly logger = new Logger(DependancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async verifier(user: AuthenticatedUser, entite: string, id: string, action: Action): Promise<Verdict> {
    const ctx = await this.contexte(user);
    return this.verifierDansContexte(ctx, entite, id, action);
  }

  /** Les quatre actions en une fois (écran : quels boutons afficher). */
  async verifierTout(user: AuthenticatedUser, entite: string, id: string): Promise<Verdict[]> {
    const ctx = await this.contexte(user);
    return Promise.all(ACTIONS.map((a) => this.verifierDansContexte(ctx, entite, id, a)));
  }

  /** Garde serveur : 409 (raison + liens) si l'action est impossible ; refus tracé. */
  async assertPossible(user: AuthenticatedUser, entite: string, id: string, action: Action): Promise<Verdict> {
    const ctx = await this.contexte(user);
    const verdict = await this.verifierDansContexte(ctx, entite, id, action);
    if (!verdict.possible) {
      await this.tracerRefus(ctx, REGISTRE[entite], verdict);
      throw new ConflictException({ message: verdict.raison, liens: verdict.liens, action, entite });
    }
    return verdict;
  }

  async verifierDansContexte(ctx: ContexteDependances, entite: string, id: string, action: Action): Promise<Verdict> {
    const def = REGISTRE[entite];
    if (!def) throw new NotFoundException(`Type d'élément inconnu : ${entite}.`);
    if (!(ACTIONS as readonly string[]).includes(action)) {
      throw new NotFoundException(`Action inconnue : ${action}.`);
    }
    this.assertRole(ctx, def);

    const rec = await def.charger(this.prisma, id, ctx);
    if (!rec) throw new NotFoundException('Élément introuvable.');

    const comptes = await Promise.all(def.dependances.map((d) => d.compter(this.prisma, rec, ctx)));
    const liens: LienCompte[] = def.dependances
      .map((d, i) => ({ d, n: comptes[i] }))
      .filter(({ n }) => n > 0)
      .map(({ d, n }) => ({ type: d.cle, libelle: n > 1 ? d.pluriel : d.singulier, nombre: n }));
    const bloquants = def.dependances
      .map((d, i) => ({ d, n: comptes[i] }))
      .filter(({ d, n }) => n > 0 && (d.bloque ?? ['supprimer']).includes(action))
      .map(({ d, n }) => ({ type: d.cle, libelle: n > 1 ? d.pluriel : d.singulier, nombre: n }));

    const nom = def.nom(rec);
    const regle = def.regles[action];
    let raison: string | null;
    if (!regle) {
      raison = `${NOM_ACTION[action]} impossible : cette action n'est pas encore disponible pour ${def.designation}.`;
    } else {
      const etat = regle(rec, ctx);
      raison = etat
        ? `${NOM_ACTION[action]} impossible : ${etat}`
        : bloquants.length > 0
          ? `${NOM_ACTION[action]} impossible : ${def.designation} « ${nom} » est lié${def.pronom === 'la' ? 'e' : ''} à ${enumerer(bloquants)}.` +
            (action === 'supprimer' && def.regles.archiver ? ` Archivez-${def.pronom} plutôt.` : '')
          : null;
    }
    return { entite, id, nom, action, possible: raison === null, raison, liens };
  }

  private assertRole(ctx: ContexteDependances, def: DefinitionEntite): void {
    const autorise =
      ctx.roleChain.some((r) => (def.roles as readonly string[]).includes(r)) ||
      (!!def.roleSociete && ctx.roleChain.includes(def.roleSociete));
    if (!autorise) {
      throw new ForbiddenException(`Rôle insuffisant pour gérer ${def.designation}.`);
    }
  }

  async contexte(user: AuthenticatedUser): Promise<ContexteDependances> {
    const { profil, permissions } = await this.identity.getMe(user);
    const roleChain = permissions?.roleChain ?? [];
    const estSuperadmin = roleChain.includes('SUPERADMIN_PRINCIPAL');
    if (!profil.organisationId && !estSuperadmin) {
      throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    }
    // Rôle société SEULEMENT (aucun rôle assureur) : périmètre = sa propre société.
    const estSociete = roleChain.some((r) => r.startsWith('SOCIETE_')) && !roleChain.some((r) => r.startsWith('ASSUREUR_'));
    return {
      userId: profil.id,
      organisationId: profil.organisationId ?? null,
      roleChain,
      societeId: profil.societeId ?? null,
      estSociete,
    };
  }

  /**
   * Refus tracé HORS transaction (ADR-007) : une transaction annulée effacerait sa ligne
   * d'audit. Qui (user), quoi (entité, action), pourquoi (raison, liens). Un échec
   * d'écriture d'audit n'empêche pas le 409 d'être renvoyé.
   */
  private async tracerRefus(ctx: ContexteDependances, def: DefinitionEntite, v: Verdict): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        SELECT log_audit(
          ${`REFUS_${v.action.toUpperCase()}`}::text,
          ${def.table}::text,
          ${v.id}::uuid,
          ${ctx.userId}::uuid,
          ${JSON.stringify({ entite: v.entite, nom: v.nom, raison: v.raison, liens: v.liens })}::jsonb
        )`;
    } catch (e) {
      this.logger.error(`Refus non tracé (${v.entite} ${v.id}) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
