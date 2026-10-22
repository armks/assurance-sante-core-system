'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PERIODES_RAPIDES } from '@/lib/periode-rapide';

const CLASSE_CHAMP =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * Barre de recherche de l'espace adhérent (factures, dispensations), sur UNE ligne : n° de carte du titulaire ou d'un
 * bénéficiaire (avec suggestions), période (aujourd'hui, semaine, mois, entre deux dates) et statut. Les filtres sont
 * écrits dans l'URL et appliqués côté serveur à tout l'historique.
 */
export function FiltresFamille({
  periode,
  cartesFamille = [],
  statuts,
}: {
  /** Période effective (jour par défaut). */
  periode: string;
  /** N° de carte du titulaire et des bénéficiaires (suggestions du champ). */
  cartesFamille?: { numeroCarte: string; nom: string }[];
  statuts: Record<string, string>;
}) {
  const router = useRouter();
  const chemin = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const idListe = useId();
  const actuel = (k: string) => params.get(k) ?? '';

  const appliquer = (modifs: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    p.delete('page');
    for (const [k, v] of Object.entries(modifs)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    start(() => router.push(qs ? `${chemin}?${qs}` : chemin, { scroll: false }));
  };

  const filtresActifs = ['carte', 'statut', 'periode', 'du', 'au'].some((k) => actuel(k));

  return (
    <form
      key={params.toString()}
      className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const val = (k: string) => String(fd.get(k) ?? '').trim() || null;
        // Deux dates saisies (ou l'une des deux) : elles l'emportent sur la période rapide.
        const du = val('du');
        const au = val('au');
        const per = du || au ? 'perso' : val('periode') === 'perso' ? 'jour' : val('periode');
        appliquer({
          carte: val('carte'),
          statut: val('statut'),
          periode: per === 'jour' ? null : per,
          du: per === 'perso' ? du : null,
          au: per === 'perso' ? au : null,
        });
      }}
    >
      <Input
        name="carte"
        list={idListe}
        defaultValue={actuel('carte')}
        placeholder="N° de carte (bénéficiaire)"
        aria-label="N° de carte du bénéficiaire"
        className="h-9 min-w-32 flex-1 px-2 font-mono"
      />
      <datalist id={idListe}>
        {cartesFamille.map((c) => (
          <option key={c.numeroCarte} value={c.numeroCarte}>
            {c.nom}
          </option>
        ))}
      </datalist>
      <select name="periode" aria-label="Période" defaultValue={periode} className={`${CLASSE_CHAMP} shrink-0`}>
        {PERIODES_RAPIDES.map((p) => (
          <option key={p.valeur} value={p.valeur}>
            {p.libelle}
          </option>
        ))}
      </select>
      <label className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
        Du
        <input name="du" type="date" defaultValue={actuel('du')} max={actuel('au') || undefined} className={`${CLASSE_CHAMP} w-[8.5rem]`} />
      </label>
      <label className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
        au
        <input name="au" type="date" defaultValue={actuel('au')} min={actuel('du') || undefined} className={`${CLASSE_CHAMP} w-[8.5rem]`} />
      </label>
      <select name="statut" aria-label="Statut" defaultValue={actuel('statut')} className={`${CLASSE_CHAMP} shrink-0`}>
        <option value="">Tous les statuts</option>
        {Object.entries(statuts).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" className="shrink-0" disabled={pending}>
        {pending ? 'Recherche…' : 'Appliquer'}
      </Button>
      {filtresActifs && (
        <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled={pending} onClick={() => start(() => router.push(chemin, { scroll: false }))}>
          Réinitialiser
        </Button>
      )}
    </form>
  );
}
