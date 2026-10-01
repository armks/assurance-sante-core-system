import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Pagination SERVEUR des listes longues (remplace les `take: N` sans suite qui
 * rendaient les éléments anciens inaccessibles) : `?page=` (1 par défaut) et
 * `?limite=` (25 par défaut, 100 au plus). Réponse : `Page<T>`.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
}

/** Pagination + période (`du` / `au`, dates incluses). */
export class PeriodeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  du?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  au?: string;
}

/** Pagination + période + recherche texte (`q`). */
export class RecherchePeriodeQueryDto extends PeriodeQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limite: number;
  pages: number;
}

export const LIMITE_PAR_DEFAUT = 25;

export function bornesPage(dto: PaginationQueryDto, defaut = LIMITE_PAR_DEFAUT) {
  const page = dto.page ?? 1;
  const limite = dto.limite ?? defaut;
  return { page, limite, offset: (page - 1) * limite };
}

export function versPage<T>(items: T[], total: number, page: number, limite: number): Page<T> {
  return { items, total, page, limite, pages: Math.max(1, Math.ceil(total / limite)) };
}

/** Période : `du` inclus dès 00:00, `au` inclus jusqu'à la fin du jour. */
export function bornesPeriode(du?: string, au?: string): { debut?: Date; finExclue?: Date } {
  const debut = du ? new Date(`${du.slice(0, 10)}T00:00:00.000Z`) : undefined;
  const finExclue = au ? new Date(new Date(`${au.slice(0, 10)}T00:00:00.000Z`).getTime() + 86_400_000) : undefined;
  return { debut, finExclue };
}

/** Même période, pour un `where` Prisma (`undefined` = pas de borne). */
export function filtrePeriode(du?: string, au?: string): { gte?: Date; lt?: Date } | undefined {
  const { debut, finExclue } = bornesPeriode(du, au);
  if (!debut && !finExclue) return undefined;
  return { ...(debut ? { gte: debut } : {}), ...(finExclue ? { lt: finExclue } : {}) };
}

/**
 * Condition SQL de recherche : CHAQUE mot de `q` doit figurer (casse et accents
 * ignorés, `public.sans_accent`, prisma/sql/066) dans le texte formé par
 * `champs` — même règle que la recherche des tableaux côté web. Les
 * caractères spéciaux de LIKE (% _ \) saisis sont échappés. Sans mot → TRUE.
 */
export function conditionRecherche(q: string | undefined, champs: Prisma.Sql[]): Prisma.Sql {
  const mots = (q ?? '').split(/\s+/).map((m) => m.trim()).filter(Boolean);
  if (mots.length === 0 || champs.length === 0) return Prisma.sql`TRUE`;
  const texte = Prisma.sql`public.sans_accent(concat_ws(' ', ${Prisma.join(champs, ', ')}))`;
  return Prisma.join(
    mots.map((mot) => {
      const echappe = mot.replace(/[\\%_]/g, (c) => `\\${c}`);
      return Prisma.sql`${texte} LIKE '%' || public.sans_accent(${echappe}) || '%' ESCAPE '\\'`;
    }),
    ' AND ',
  );
}
