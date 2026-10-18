'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { rechercherMedicamentsBase, type MedicamentBase } from '@/app/dashboard-pharmacie/dispensation-actions';
import { Champ } from '@/components/dashboard/patterns/champs';
import { Input } from '@/components/ui/input';

const libelle = (m: MedicamentBase) =>
  m.nomCommercial && m.nomCommercial.toLowerCase() !== m.denominationCommune.toLowerCase()
    ? `${m.denominationCommune} (${m.nomCommercial})`
    : m.denominationCommune;

const precision = (m: MedicamentBase) => [m.dosage, m.forme].filter(Boolean).join(' · ');

/**
 * Choix OBLIGATOIRE d'un médicament dans la base (catalogue activé par l'assureur) : le pharmacien tape quelques lettres, choisit dans
 * la liste ; seul l'identifiant du médicament choisi est envoyé (champ caché `name`, vide tant qu'aucun choix n'est fait).
 * Aucune saisie libre n'est acceptée — l'appelant refuse la soumission si le champ est vide.
 */
export function ChampMedicamentBase({
  name = 'medicamentId',
  label = 'Médicament',
}: {
  name?: string;
  label?: string;
}) {
  const id = useId();
  const [saisie, setSaisie] = useState('');
  const [choix, setChoix] = useState<MedicamentBase | null>(null);
  const [resultats, setResultats] = useState<MedicamentBase[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState(false);
  const derniere = useRef(0);

  useEffect(() => {
    const terme = saisie.trim();
    if (choix || terme.length < 2) {
      setResultats([]);
      setRecherche(false);
      return;
    }
    const num = ++derniere.current;
    setRecherche(true);
    const t = setTimeout(async () => {
      const r = await rechercherMedicamentsBase(terme);
      if (num !== derniere.current) return;
      setResultats(r);
      setRecherche(false);
    }, 250);
    return () => clearTimeout(t);
  }, [saisie, choix]);

  return (
    <Champ label={label} htmlFor={`${id}-saisie`} requis aide="Tapez quelques lettres, puis choisissez le médicament dans la liste de la base.">
      <input type="hidden" name={name} value={choix?.id ?? ''} />
      {choix ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2 text-sm">
          <span>
            {libelle(choix)}
            {precision(choix) && <span className="text-muted-foreground"> — {precision(choix)}</span>}
          </span>
          <button
            type="button"
            aria-label="Changer de médicament"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              setChoix(null);
              setSaisie('');
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id={`${id}-saisie`}
            value={saisie}
            autoComplete="off"
            placeholder="Ex. paracétamol"
            role="combobox"
            aria-expanded={ouvert && resultats.length > 0}
            aria-controls={`${id}-liste`}
            onChange={(e) => {
              setSaisie(e.target.value);
              setOuvert(true);
            }}
            onFocus={() => setOuvert(true)}
            onBlur={() => setTimeout(() => setOuvert(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
          {ouvert && saisie.trim().length >= 2 && (
            <ul
              id={`${id}-liste`}
              role="listbox"
              className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover text-sm text-popover-foreground shadow-md"
            >
              {resultats.map((m) => (
                <li
                  key={m.id}
                  role="option"
                  aria-selected={false}
                  className="cursor-pointer px-3 py-2 hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setChoix(m);
                    setOuvert(false);
                  }}
                >
                  {libelle(m)}
                  {precision(m) && <span className="text-muted-foreground"> — {precision(m)}</span>}
                </li>
              ))}
              {recherche && <li className="px-3 py-2 text-muted-foreground">Recherche…</li>}
              {!recherche && resultats.length === 0 && (
                <li className="px-3 py-2 text-muted-foreground">Aucun médicament trouvé dans la base.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </Champ>
  );
}
