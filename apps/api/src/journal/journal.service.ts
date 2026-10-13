import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';

/** Qui peut consulter le journal des actions : la direction et l'informatique de l'assureur (leur organisation), le superadmin (toutes). */
export const ROLES_CONSULTATION_JOURNAL = ['SUPERADMIN_PRINCIPAL', 'ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'] as const;

export interface FiltresJournal {
  userId?: string;
  table?: string;
  enregistrementId?: string;
  operation?: string;
  du?: string;
  au?: string;
  limite?: number;
  decalage?: number;
}

export interface LigneJournal {
  id: string;
  date: Date;
  operation: string;
  table: string;
  enregistrementId: string | null;
  champsModifies: string[];
  requete: string | null;
  auteur: {
    id: string;
    email: string | null;
    pseudo: string | null;
    role: string | null;
    libelleRole: string | null;
    etablissement: string | null;
    pharmacie: string | null;
    societe: string | null;
  };
}

const LIMITE_MAX = 200;

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * Journal des actions (création / modification / suppression) avec l'identité de leur auteur au moment de l'action.
   * Un assureur ne voit que les actions de SON organisation ; seul le superadmin voit tout.
   */
  async lister(user: AuthenticatedUser, filtres: FiltresJournal = {}): Promise<{ total: number; lignes: LigneJournal[] }> {
    const { profil, permissions } = await this.identity.getMe(user);
    const chaine = permissions?.roleChain ?? [];
    if (!chaine.some((r) => (ROLES_CONSULTATION_JOURNAL as readonly string[]).includes(r))) {
      throw new ForbiddenException('Le journal des actions est réservé à la direction, à l’informatique de l’assureur et au superadministrateur.');
    }
    const superadmin = chaine.includes('SUPERADMIN_PRINCIPAL');

    const conditions: Prisma.Sql[] = [];
    if (!superadmin) conditions.push(Prisma.sql`j.organisation_id = ${profil.organisationId}::uuid`);
    if (filtres.userId) conditions.push(Prisma.sql`j.user_id = ${filtres.userId}::uuid`);
    if (filtres.table) conditions.push(Prisma.sql`j.table_cible = ${filtres.table}`);
    if (filtres.enregistrementId) conditions.push(Prisma.sql`j.enregistrement_id = ${filtres.enregistrementId}`);
    if (filtres.operation) conditions.push(Prisma.sql`j.operation = ${filtres.operation}`);
    if (filtres.du) conditions.push(Prisma.sql`j.created_at >= ${filtres.du}::timestamptz`);
    if (filtres.au) conditions.push(Prisma.sql`j.created_at < (${filtres.au}::date + 1)`);
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const limite = Math.min(Math.max(filtres.limite ?? 50, 1), LIMITE_MAX);
    const decalage = Math.max(filtres.decalage ?? 0, 0);

    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM public.journal_actions j ${where}`;
    const lignes = await this.prisma.$queryRaw<
      {
        id: string;
        created_at: Date;
        operation: string;
        table_cible: string;
        enregistrement_id: string | null;
        champs_modifies: string[] | null;
        requete: string | null;
        user_id: string;
        email: string | null;
        pseudo: string | null;
        role: string | null;
        libelle_role: string | null;
        etablissement: string | null;
        pharmacie: string | null;
        societe: string | null;
      }[]
    >`
      SELECT j.id, j.created_at, j.operation, j.table_cible, j.enregistrement_id, j.champs_modifies, j.requete,
             j.user_id, u.email, p.pseudo, j.role, sr.libelle AS libelle_role,
             e.nom AS etablissement, ph.nom AS pharmacie, s.nom AS societe
        FROM public.journal_actions j
        LEFT JOIN auth.users u ON u.id = j.user_id
        LEFT JOIN public.profils p ON p.id = j.user_id
        LEFT JOIN public.sous_roles sr ON sr.code = j.role
        LEFT JOIN public.etablissements_sante e ON e.id = j.etablissement_id
        LEFT JOIN public.pharmacies ph ON ph.id = j.pharmacie_id
        LEFT JOIN public.souscripteurs s ON s.id = j.societe_id
        ${where}
       ORDER BY j.created_at DESC
       LIMIT ${limite} OFFSET ${decalage}`;

    return {
      total: Number(total),
      lignes: lignes.map((l) => ({
        id: l.id,
        date: l.created_at,
        operation: l.operation,
        table: l.table_cible,
        enregistrementId: l.enregistrement_id,
        champsModifies: l.champs_modifies ?? [],
        requete: l.requete,
        auteur: {
          id: l.user_id,
          email: l.email,
          pseudo: l.pseudo,
          role: l.role,
          libelleRole: l.libelle_role,
          etablissement: l.etablissement,
          pharmacie: l.pharmacie,
          societe: l.societe,
        },
      })),
    };
  }
}
