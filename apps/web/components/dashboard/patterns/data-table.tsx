'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import * as React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { correspondRecherche } from '@/lib/recherche-texte';
import { cn } from '@/lib/utils';

const CLASSE_SELECT =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Sélection de lignes (actions de masse). La sélection ne porte QUE sur la page affichée : la case d'en-tête coche les lignes
 * de la page, et tout changement de page, de filtre, de recherche ou de tri vide la sélection (jamais d'action sur des
 * lignes que l'utilisateur ne voit plus).
 */
export interface SelectionTable<T> {
  ids: ReadonlySet<string>;
  onChange: (ids: Set<string>) => void;
  /** Barre d'actions affichée sous le compteur quand au moins une ligne est sélectionnée (lignes sélectionnées). */
  barre?: (lignes: T[]) => React.ReactNode;
}

/** Définition d'une colonne. `T` = type d'une ligne. */
export interface ColonneTable<T> {
  cle: string;
  entete: string;
  /** Rendu personnalisé de la cellule (sinon `String(row[cle])`). */
  rendu?: (row: T) => React.ReactNode;
  /** Valeur utilisée pour le tri / la recherche (sinon `row[cle]`, chemins `a.b` supportés). */
  valeur?: (row: T) => string | number | null | undefined;
  triable?: boolean;
  className?: string;
  aligneDroite?: boolean;
}

export interface FiltreSelect {
  cle: string;
  libelle: string;
  options: { valeur: string; libelle: string }[];
  valeur?: (row: unknown) => string | null | undefined;
}

function lire(row: object, cle: string): unknown {
  return cle.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object')
      return (acc as Record<string, unknown>)[k];
    return undefined;
  }, row as Record<string, unknown>);
}

/**
 * Tableau de données générique : recherche plein texte, filtres `select`, tri
 * par colonne, pagination, état vide et état de chargement. Filtrage / tri /
 * pagination sont **client-side** (les données sont chargées côté serveur).
 */
export function DataTable<T extends object>({
  colonnes,
  donnees,
  cleLigne,
  recherche,
  filtres = [],
  actions,
  actionLigne,
  classeLigne,
  surClicLigne,
  chargement = false,
  parPage = 10,
  vide = 'Aucune donnée.',
  tailleTexte = 'text-sm',
  piedMasque = false,
  selection,
  compact = false,
}: {
  colonnes: ColonneTable<T>[];
  donnees: T[];
  cleLigne: (row: T) => string;
  recherche?: { placeholder?: string; champs: string[] };
  filtres?: FiltreSelect[];
  /** Barre d'outils à droite (bouton « Nouveau »…). */
  actions?: React.ReactNode;
  /** Cellule d'action en fin de ligne. */
  actionLigne?: (row: T) => React.ReactNode;
  /** Clic (ou Entrée) sur une ligne : ouvre un détail. Les boutons / liens de la ligne gardent leur propre action. */
  surClicLigne?: (row: T) => void;
  /** Classe CSS ajoutée à une ligne (ex. surlignage d'un état particulier). */
  classeLigne?: (row: T) => string | undefined;
  chargement?: boolean;
  /** Lignes par page (0 = pas de pagination). */
  parPage?: number;
  vide?: React.ReactNode;
  tailleTexte?: string;
  /**
   * Masque le compteur / la pagination internes : pour une liste paginée CÔTÉ
   * SERVEUR, où `PaginationServeur` affiche le vrai total filtré.
   */
  piedMasque?: boolean;
  /** Lignes resserrées : cellules plus étroites, texte sur UNE seule ligne (le contenu long est tronqué par la colonne). */
  compact?: boolean;
  /** Cases à cocher par ligne + « tout sélectionner (page affichée) » + compteur. */
  selection?: SelectionTable<T>;
}) {
  const [q, setQ] = useState('');
  const [valeursFiltres, setValeursFiltres] = useState<Record<string, string>>(
    {},
  );
  const [tri, setTri] = useState<{ cle: string; sens: 'asc' | 'desc' } | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const idRecherche = useId();

  const colonneParCle = useMemo(
    () => new Map(colonnes.map((c) => [c.cle, c])),
    [colonnes],
  );

  const lignesFiltrees = useMemo(() => {
    let out = donnees;

    if (recherche && q.trim()) {
      // Insensible à la casse et aux accents ; chaque mot doit figurer dans au
      // moins un champ (« prénom nom » trouve la personne).
      out = out.filter((row) =>
        correspondRecherche(
          recherche.champs.map((champ) => lire(row, champ)),
          q,
        ),
      );
    }

    for (const f of filtres) {
      const v = valeursFiltres[f.cle];
      if (v) {
        out = out.filter((row) => {
          const val = f.valeur ? f.valeur(row) : lire(row, f.cle);
          return String(val ?? '') === v;
        });
      }
    }

    if (tri) {
      const col = colonneParCle.get(tri.cle);
      const val = (row: T) =>
        col?.valeur ? col.valeur(row) : (lire(row, tri.cle) as string | number);
      out = [...out].sort((a, b) => {
        const va = val(a) ?? '';
        const vb = val(b) ?? '';
        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'fr', { numeric: true });
        return tri.sens === 'asc' ? cmp : -cmp;
      });
    }

    return out;
  }, [donnees, q, recherche, filtres, valeursFiltres, tri, colonneParCle]);

  // revient à la page 1 quand les filtres changent
  useEffect(() => {
    setPage(1);
  }, [q, valeursFiltres]);

  const pagination = parPage > 0 && lignesFiltrees.length > parPage;
  const nbPages = pagination ? Math.ceil(lignesFiltrees.length / parPage) : 1;
  const pageSure = Math.min(page, nbPages);
  const lignesAffichees = pagination
    ? lignesFiltrees.slice((pageSure - 1) * parPage, pageSure * parPage)
    : lignesFiltrees;

  // la sélection est vidée quand la page, les filtres, la recherche ou le tri changent
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const signatureAffichage = `${pageSure}|${q}|${JSON.stringify(valeursFiltres)}|${tri ? `${tri.cle}${tri.sens}` : ''}`;
  useEffect(() => {
    const sel = selectionRef.current;
    if (sel && sel.ids.size > 0) sel.onChange(new Set());
  }, [signatureAffichage]);
  const lignesSelectionnees = selection ? lignesAffichees.filter((r) => selection.ids.has(cleLigne(r))) : [];
  const toutCoche = lignesAffichees.length > 0 && lignesSelectionnees.length === lignesAffichees.length;
  const basculerLigne = (row: T) => {
    if (!selection) return;
    const next = new Set(selection.ids);
    const id = cleLigne(row);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  const basculerTout = () => {
    if (!selection) return;
    selection.onChange(toutCoche ? new Set() : new Set(lignesAffichees.map(cleLigne)));
  };

  const basculerTri = (cle: string) =>
    setTri((t) =>
      t?.cle !== cle
        ? { cle, sens: 'asc' }
        : t.sens === 'asc'
          ? { cle, sens: 'desc' }
          : null,
    );

  const nbCol = colonnes.length + (actionLigne ? 1 : 0) + (selection ? 1 : 0);
  const aBarreOutils = recherche || filtres.length > 0 || actions;

  return (
    <div className="space-y-3">
      {aBarreOutils && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {recherche && (
              <div className="relative">
                <label htmlFor={idRecherche} className="sr-only">
                  Rechercher dans le tableau
                </label>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id={idRecherche}
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={recherche.placeholder ?? 'Rechercher…'}
                  className="h-9 w-56 pl-8"
                />
              </div>
            )}
            {filtres.map((f) => (
              <select
                key={f.cle}
                className={CLASSE_SELECT}
                value={valeursFiltres[f.cle] ?? ''}
                onChange={(e) =>
                  setValeursFiltres((v) => ({ ...v, [f.cle]: e.target.value }))
                }
                aria-label={f.libelle}
              >
                <option value="">{f.libelle} : tous</option>
                {f.options.map((o) => (
                  <option key={o.valeur} value={o.valeur}>
                    {o.libelle}
                  </option>
                ))}
              </select>
            ))}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}

      {selection && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid="barre-selection">
          <span role="status">
            <strong>{lignesSelectionnees.length}</strong> sélectionné{lignesSelectionnees.length > 1 ? 's' : ''}
            <span className="ml-2 text-xs text-muted-foreground">
              La sélection ne porte que sur la page affichée ({lignesAffichees.length} ligne{lignesAffichees.length > 1 ? 's' : ''}) ; elle est vidée si vous changez de page, de filtre ou de tri.
            </span>
          </span>
          {lignesSelectionnees.length > 0 && selection.barre && <span className="flex flex-wrap items-center gap-2">{selection.barre(lignesSelectionnees)}</span>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className={cn('w-full', tailleTexte)}>
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              {selection && (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner (page affichée)"
                    checked={toutCoche}
                    disabled={lignesAffichees.length === 0}
                    onChange={basculerTout}
                  />
                </th>
              )}
              {colonnes.map((c) => (
                <th
                  key={c.cle}
                  aria-sort={
                    !c.triable
                      ? undefined
                      : tri?.cle === c.cle
                        ? tri.sens === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                  }
                  className={cn(
                    compact ? 'whitespace-nowrap px-3 py-1.5 font-medium' : 'px-3 py-2 font-medium',
                    c.aligneDroite && 'text-right',
                    c.className,
                  )}
                >
                  {c.triable ? (
                    <button
                      type="button"
                      onClick={() => basculerTri(c.cle)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.entete}
                      {tri?.cle === c.cle ? (
                        tri.sens === 'asc' ? (
                          <ArrowUp aria-hidden="true" className="size-3" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="size-3" />
                        )
                      ) : (
                        <ArrowUpDown
                          aria-hidden="true"
                          className="size-3 opacity-40"
                        />
                      )}
                    </button>
                  ) : (
                    c.entete
                  )}
                </th>
              ))}
              {actionLigne && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {chargement ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-t">
                  {Array.from({ length: nbCol }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <span className="block h-4 w-full animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <>
                {lignesAffichees.map((row) => (
                  <tr
                    key={cleLigne(row)}
                    className={cn('border-t', classeLigne?.(row), surClicLigne && 'cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none')}
                    data-selectionne={selection?.ids.has(cleLigne(row)) ? 'oui' : undefined}
                    tabIndex={surClicLigne ? 0 : undefined}
                    onClick={
                      surClicLigne
                        ? (e) => {
                            if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label')) return;
                            surClicLigne(row);
                          }
                        : undefined
                    }
                    onKeyDown={
                      surClicLigne
                        ? (e) => {
                            if (e.key === 'Enter' && e.target === e.currentTarget) surClicLigne(row);
                          }
                        : undefined
                    }
                  >
                    {selection && (
                      <td className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner la ligne ${cleLigne(row)}`}
                          checked={selection.ids.has(cleLigne(row))}
                          onChange={() => basculerLigne(row)}
                        />
                      </td>
                    )}
                    {colonnes.map((c) => (
                      <td
                        key={c.cle}
                        className={cn(
                          compact ? 'whitespace-nowrap px-3 py-1' : 'px-3 py-2',
                          c.aligneDroite && 'text-right tabular-nums',
                          c.className,
                        )}
                      >
                        {c.rendu
                          ? c.rendu(row)
                          : String(lire(row, c.cle) ?? '—')}
                      </td>
                    ))}
                    {actionLigne && (
                      <td className={cn(compact ? 'whitespace-nowrap px-3 py-1' : 'px-3 py-2', 'text-right')}>
                        <span className="flex justify-end gap-2">
                          {actionLigne(row)}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
                {lignesFiltrees.length === 0 && (
                  <tr className="border-t">
                    <td
                      className="px-3 py-8 text-center text-muted-foreground"
                      colSpan={nbCol}
                    >
                      {donnees.length === 0
                        ? vide
                        : 'Aucun résultat pour ces filtres.'}
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {!piedMasque && !chargement && lignesFiltrees.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {lignesFiltrees.length} / {donnees.length}
            {pagination && ` — page ${pageSure}/${nbPages}`}
          </span>
          {pagination && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={pageSure <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Page précédente"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={pageSure >= nbPages}
                onClick={() => setPage((p) => Math.min(nbPages, p + 1))}
                aria-label="Page suivante"
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
