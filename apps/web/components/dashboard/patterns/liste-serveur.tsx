'use client';

import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const CLASSE_CHAMP =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Réponse paginée de l'API (`common/pagination.ts`). */
export interface PageServeur<T> {
  items: T[];
  total: number;
  page: number;
  limite: number;
  pages: number;
}

export interface FiltreServeurSelect {
  cle: string;
  libelle: string;
  options: { valeur: string; libelle: string }[];
}

/** Met à jour l'URL (et donc la requête serveur) en gardant les autres paramètres. */
function useParametres() {
  const router = useRouter();
  const chemin = usePathname();
  const actuels = useSearchParams();
  const [enCours, demarrer] = useTransition();
  const appliquer = (modifs: Record<string, string | null>) => {
    const p = new URLSearchParams(actuels.toString());
    for (const [k, v] of Object.entries(modifs)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    demarrer(() => router.push(qs ? `${chemin}?${qs}` : chemin, { scroll: false }));
  };
  return { actuels, appliquer, enCours };
}

/**
 * Filtres d'une liste paginée CÔTÉ SERVEUR : recherche texte (`q`), période
 * (`du` / `au`) et listes déroulantes — écrits dans l'URL, donc envoyés à
 * l'API, appliqués à TOUT l'historique (pas seulement à la page affichée).
 * Toute modification ramène à la page 1.
 */
export function FiltresServeur({
  recherche,
  periode = false,
  libellePeriode = 'Période',
  selects = [],
  prefixe = '',
}: {
  /** Préfixe des paramètres d'URL (`q`, `page`, sélecteurs) pour deux listes serveur sur une même page (ex. `m` → `mq`, `mpage`). */
  prefixe?: string;
  recherche?: { placeholder: string };
  periode?: boolean;
  libellePeriode?: string;
  selects?: FiltreServeurSelect[];
}) {
  const { actuels, appliquer, enCours } = useParametres();
  const id = useId();
  const cle = (k: string) => prefixe + k;
  const actifs = ['q', 'du', 'au', ...selects.map((s) => s.cle)].some((k) => actuels.get(cle(k)));

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const modifs: Record<string, string | null> = { [cle('page')]: null };
        for (const k of ['q', 'du', 'au', ...selects.map((s) => s.cle)]) {
          if (fd.has(cle(k))) modifs[cle(k)] = String(fd.get(cle(k)) ?? '').trim() || null;
        }
        appliquer(modifs);
      }}
    >
      {recherche && (
        <div className="relative">
          <label htmlFor={`${id}-q`} className="sr-only">
            Rechercher
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${id}-q`}
            name={cle('q')}
            type="search"
            defaultValue={actuels.get(cle('q')) ?? ''}
            placeholder={recherche.placeholder}
            className="h-9 w-64 pl-8"
          />
        </div>
      )}
      {periode && (
        <fieldset className="flex items-end gap-1">
          <legend className="sr-only">{libellePeriode}</legend>
          <label className="grid gap-0.5 text-xs text-muted-foreground">
            {libellePeriode} — du
            <input name={cle('du')} type="date" defaultValue={actuels.get(cle('du')) ?? ''} className={CLASSE_CHAMP} />
          </label>
          <label className="grid gap-0.5 text-xs text-muted-foreground">
            au
            <input name={cle('au')} type="date" defaultValue={actuels.get(cle('au')) ?? ''} className={CLASSE_CHAMP} />
          </label>
        </fieldset>
      )}
      {selects.map((s) => (
        <select
          key={s.cle}
          name={cle(s.cle)}
          aria-label={s.libelle}
          defaultValue={actuels.get(cle(s.cle)) ?? ''}
          className={CLASSE_CHAMP}
        >
          <option value="">{s.libelle} : tous</option>
          {s.options.map((o) => (
            <option key={o.valeur} value={o.valeur}>
              {o.libelle}
            </option>
          ))}
        </select>
      ))}
      <Button type="submit" size="sm" disabled={enCours}>
        {enCours ? 'Recherche…' : 'Appliquer'}
      </Button>
      {actifs && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={enCours}
          onClick={(e) => {
            e.currentTarget.form?.reset();
            appliquer(Object.fromEntries(['q', 'du', 'au', 'page', ...selects.map((s) => s.cle)].map((k) => [cle(k), null])));
          }}
        >
          <X aria-hidden="true" className="size-4" />
          Réinitialiser
        </Button>
      )}
    </form>
  );
}

/** Pied d'une liste paginée côté serveur : total FILTRÉ et navigation page à page. */
export function PaginationServeur({ page, pages, total, limite, prefixe = '' }: Omit<PageServeur<unknown>, 'items'> & { prefixe?: string }) {
  const { appliquer, enCours } = useParametres();
  if (total === 0) return null;
  const debut = (page - 1) * limite + 1;
  const fin = Math.min(page * limite, total);
  return (
    <div className={cn('flex items-center justify-between text-xs text-muted-foreground', enCours && 'opacity-60')}>
      <span>
        {page > pages ? '0' : `${debut}–${fin}`} sur {total.toLocaleString('fr-FR')} — page {page}/{pages}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={page <= 1 || enCours}
            onClick={() => appliquer({ [`${prefixe}page`]: page - 1 > 1 ? String(page - 1) : null })}
            aria-label="Page précédente"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            disabled={page >= pages || enCours}
            onClick={() => appliquer({ [`${prefixe}page`]: String(page + 1) })}
            aria-label="Page suivante"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
