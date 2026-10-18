'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { rechercherMaladiesCim10, type MaladieProposee } from '@/app/cim10-actions';
import { Champ } from '@/components/dashboard/patterns/champs';
import { Input } from '@/components/ui/input';

/**
 * Choix d'une maladie dans le référentiel CIM-10 (alimenté par le superadmin) : le médecin tape un code ou un nom,
 * choisit dans la liste « code — maladie » ; seul le CODE est envoyé (champ `name`).
 */
export function ChampCim10({ name = 'codeCim10', label = 'Diagnostic (CIM-10)' }: { name?: string; label?: string }) {
  const id = useId();
  const [saisie, setSaisie] = useState('');
  const [choix, setChoix] = useState<MaladieProposee | null>(null);
  const [resultats, setResultats] = useState<MaladieProposee[]>([]);
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
      const r = await rechercherMaladiesCim10(terme);
      if (num !== derniere.current) return;
      setResultats(r);
      setRecherche(false);
    }, 250);
    return () => clearTimeout(t);
  }, [saisie, choix]);

  return (
    <Champ label={label} htmlFor={`${id}-saisie`} aide="Tapez un code (B50) ou un nom de maladie, puis choisissez dans la liste. Optionnel.">
      <input type="hidden" name={name} value={choix?.code ?? ''} />
      {choix ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2 text-sm">
          <span>
            <span className="font-mono font-semibold">{choix.code}</span> — {choix.libelle}
          </span>
          <button
            type="button"
            aria-label="Retirer le diagnostic"
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
            placeholder="Ex. B50 ou paludisme"
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
              if (e.key === 'Enter') e.preventDefault(); // ne pas soumettre le formulaire en choisissant
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
                  key={m.code}
                  role="option"
                  aria-selected={false}
                  className="cursor-pointer px-3 py-2 hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setChoix(m);
                    setOuvert(false);
                  }}
                >
                  <span className="font-mono font-semibold">{m.code}</span> — {m.libelle}
                </li>
              ))}
              {!recherche && resultats.length === 0 && (
                <li className="px-3 py-2 text-muted-foreground">Aucune maladie trouvée dans le référentiel.</li>
              )}
              {recherche && <li className="px-3 py-2 text-muted-foreground">Recherche…</li>}
            </ul>
          )}
        </div>
      )}
    </Champ>
  );
}
