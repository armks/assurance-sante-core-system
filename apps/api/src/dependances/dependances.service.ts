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

/** Éléments évalués au plus par appel de liste (une page de table). */
const MAX_LISTE = 200;

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
    const def = this.definition(entite);
    this.assertRole(ctx, def);
    const rec = await def.charger(this.prisma, id, ctx);
    if (!rec) throw new NotFoundException('Élément introuvable.');
    const comptes = await this.compter(def, rec, ctx);
    return ACTIONS.map((a) => this.evaluer(ctx, entite, def, rec, id, comptes, a));
  }

  /**
   * Verdicts d'une LISTE d'éléments (boutons d'une table) : `{ id: { action: verdict } }`.
   * Les éléments hors périmètre sont simplement absents (rien n'est révélé). Les liens
   * de chaque élément sont comptés une seule fois pour les quatre actions.
   */
  async verifierListe(
    user: AuthenticatedUser,
    entite: string,
    ids: string[],
  ): Promise<Record<string, Record<Action, Pick<Verdict, 'possible' | 'raison' | 'code'>>>> {
    const ctx = await this.contexte(user);
    const def = this.definition(entite);
    this.assertRole(ctx, def);
    const resultat: Record<string, Record<Action, Pick<Verdict, 'possible' | 'raison' | 'code'>>> = {};
    for (const id of [...new Set(ids)].slice(0, MAX_LISTE)) {
      const rec = await def.charger(this.prisma, id, ctx);
      if (!rec) continue;
      const comptes = await this.compter(def, rec, ctx);
      resultat[id] = Object.fromEntries(
        ACTIONS.map((a) => {
          const v = this.evaluer(ctx, entite, def, rec, id, comptes, a);
          return [a, { possible: v.possible, raison: v.raison, code: v.code }];
        }),
      ) as Record<Action, Pick<Verdict, 'possible' | 'raison' | 'code'>>;
    }
    return resultat;
  }

  /**
   * Garde serveur : action impossible → refus tracé, puis 403 (rôle non autorisé) ou
   * 409 (état, liens) avec la raison et les nombres.
   */
  async assertPossible(user: AuthenticatedUser, entite: string, id: string, action: Action): Promise<Verdict> {
    const ctx = await this.contexte(user);
    const verdict = await this.verifierDansContexte(ctx, entite, id, action);
    if (!verdict.possible) {
      await this.tracerRefus(ctx, REGISTRE[entite], verdict);
      const corps = { message: verdict.raison, liens: verdict.liens, action, entite };
      throw verdict.code === 'ROLE' ? new ForbiddenException(corps) : new ConflictException(corps);
    }
    return verdict;
  }

  async verifierDansContexte(ctx: ContexteDependances, entite: string, id: string, action: Action): Promise<Verdict> {
    const def = this.definition(entite);
    if (!(ACTIONS as readonly string[]).includes(action)) {
      throw new NotFoundException(`Action inconnue : ${action}.`);
    }
    this.assertRole(ctx, def);

    const rec = await def.charger(this.prisma, id, ctx);
    if (!rec) throw new NotFoundException('Élément introuvable.');

    const comptes = await this.compter(def, rec, ctx);
    return this.evaluer(ctx, entite, def, rec, id, comptes, action);
  }

  private definition(entite: string): DefinitionEntite {
    const def = REGISTRE[entite];
    if (!def) throw new NotFoundException(`Type d'élément inconnu : ${entite}.`);
    return def;
  }

  private async compter(def: DefinitionEntite, rec: unknown, ctx: ContexteDependances): Promise<number[]> {
    const bruts = await Promise.all(def.dependances.map((d) => d.compter(this.prisma, rec, ctx)));
    // Garde-fou « aucun autre … » : un décompte NUL bloque (1), sinon le lien ne compte pas (0).
    return bruts.map((n, i) => {
      const d = def.dependances[i];
      return d.bloquantSiNul ? ((d.concerne?.(rec) ?? true) && n === 0 ? 1 : 0) : n;
    });
  }

  /** Verdict d'UNE action à partir des liens déjà comptés : rôle, puis état, puis liens. */
  private evaluer(
    ctx: ContexteDependances,
    entite: string,
    def: DefinitionEntite,
    rec: unknown,
    id: string,
    comptes: number[],
    action: Action,
  ): Verdict {
    const enLien = (filtre: (d: DefinitionEntite['dependances'][number], n: number) => boolean): LienCompte[] =>
      def.dependances
        .map((d, i) => ({ d, n: comptes[i] }))
        .filter(({ d, n }) => n > 0 && filtre(d, n))
        .map(({ d, n }) => ({ type: d.cle, libelle: n > 1 ? d.pluriel : d.singulier, nombre: n }));
    const liens = enLien(() => true);
    const bloquants = enLien((d) => (d.bloque ?? ['supprimer']).includes(action));

    const nom = def.nom(rec);
    const regle = def.regles[action];
    const NOM = def.nomsAction?.[action] ?? NOM_ACTION[action];
    let raison: string | null = null;
    let code: Verdict['code'] = null;
    if (!regle) {
      raison = `${NOM} impossible : cette action n'est pas encore disponible pour ${def.designation}.`;
      code = 'ETAT';
    } else if (
      action === 'supprimer' &&
      def.rolesSuppression &&
      !ctx.roleChain.some((r) => (def.rolesSuppression as readonly string[]).includes(r))
    ) {
      raison = `Suppression impossible : la suppression définitive est réservée ${def.libelleRolesSuppression ?? 'à un autre rôle'}.`;
      code = 'ROLE';
    } else if (
      (action === 'archiver' || action === 'desarchiver') &&
      def.rolesArchivage &&
      !ctx.roleChain.some((r) => (def.rolesArchivage as readonly string[]).includes(r))
    ) {
      raison = `${NOM} impossible : l'archivage est réservé ${def.libelleRolesArchivage ?? 'à un autre rôle'}.`;
      code = 'ROLE';
    } else {
      // Garde-fou à MOTIF (« dernier administrateur… ») : prioritaire sur les règles d'état, car
      // il protège l'organisation même si une autre règle (auto-révocation…) s'applique aussi.
      const avecMotif = bloquants
        .map((l) => def.dependances.find((d) => d.cle === l.type)?.motif)
        .filter((m): m is string => !!m);
      const etat = avecMotif.length > 0 ? null : regle(rec, ctx);
      if (avecMotif.length > 0) {
        raison = `${NOM} impossible : ${avecMotif[0]}.`;
        code = 'LIENS';
      } else if (etat) {
        raison = `${NOM} impossible : ${etat}`;
        code = 'ETAT';
      } else if (bloquants.length > 0) {
        const conseil =
          def.conseils?.[action] ??
          (action === 'supprimer' && def.regles.archiver ? `Archivez-${def.pronom} plutôt.` : null);
        raison =
          `${NOM} impossible : ${def.designation} « ${nom} » est lié${def.pronom === 'la' ? 'e' : ''} à ${enumerer(bloquants)}.` +
          (conseil ? ` ${conseil}` : '');
        code = 'LIENS';
      }
    }
    return { entite, id, nom, action, possible: raison === null, raison, liens, code };
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
      niveauAcces: permissions?.niveauAcces ?? 'LECTURE_SEULE',
    };
  }

  /**
   * Refus MÉTIER tracé hors transaction (auto-validation, chevauchement, document manquant…) : mêmes règles que
   * les refus du registre — l'audit survit au rejet, un échec d'écriture n'empêche pas le 403 / 409.
   */
  async tracerRefusMetier(user: AuthenticatedUser, table: string, id: string, action: string, raison: string): Promise<void> {
    try {
      const ctx = await this.contexte(user);
      await this.prisma.$executeRaw`
        SELECT log_audit(
          ${`REFUS_${action.toUpperCase()}`}::text,
          ${table}::text,
          ${id}::uuid,
          ${ctx.userId}::uuid,
          ${JSON.stringify({ raison })}::jsonb
        )`;
    } catch (e) {
      this.logger.error(`Refus non tracé (${table} ${id}) : ${e instanceof Error ? e.message : String(e)}`);
    }
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
