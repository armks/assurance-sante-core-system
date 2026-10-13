'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import {
  rechercherMedicamentsCatalogue,
  type MedicamentCatalogue,
} from '@/app/dashboard-centre-medical/medecin/actions';
import { Champ } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEchapFermeTableau } from './popup-recherche';

/** Ligne d'ordonnance telle qu'envoyée à l'API (aucun prix : une prescription ne porte pas de montant). */
export interface LigneOrdonnanceSaisie {
  /** Clé locale (liste React) — jamais envoyée. */
  cle: string;
  /** Identifiant du médicament de la base ; absent pour un médicament saisi hors base. */
  medicamentId: string | null;
  medicament: string;
  dosage: string;
  posologie: string;
  duree: string;
  quantite: string;
}

const libelleMedicament = (m: MedicamentCatalogue) =>
  m.nomCommercial && m.nomCommercial.toLowerCase() !== m.denominationCommune.toLowerCase()
    ? `${m.denominationCommune} (${m.nomCommercial})`
    : m.denominationCommune;

const dosageMedicament = (m: MedicamentCatalogue) => [m.dosage, m.forme].filter(Boolean).join(' · ');

/** Lit les lignes sérialisées par `ChampsMedicamentsOrdonnance` (champ caché `lignes`) et les valide. */
export function lireLignesOrdonnance(
  fd: FormData,
): { ok: true; lignes: { medicament: string; dosage?: string; posologie: string; duree?: string; quantite?: number }[] } | { ok: false; error: string } {
  let brutes: LigneOrdonnanceSaisie[] = [];
  try {
    brutes = JSON.parse(String(fd.get('lignes') ?? '[]')) as LigneOrdonnanceSaisie[];
  } catch {
    brutes = [];
  }
  if (brutes.length === 0) return { ok: false, error: 'Ajoutez au moins un médicament à l’ordonnance.' };
  const manquante = brutes.find((l) => !l.posologie.trim());
  if (manquante) return { ok: false, error: `Renseignez la posologie de « ${manquante.medicament} ».` };
  return {
    ok: true,
    lignes: brutes.map((l) => ({
      medicament: l.medicament,
      dosage: l.dosage.trim() || undefined,
      posologie: l.posologie.trim(),
      duree: l.duree.trim() || undefined,
      quantite: l.quantite.trim() ? Math.max(1, Math.round(Number(l.quantite))) : undefined,
    })),
  };
}

/**
 * Médicaments d'une ordonnance : la recherche se fait dans la base des médicaments du système — dès les premières lettres, un TABLEAU POPUP
 * (médicament, dosage / forme) liste les correspondants ; le choisir (souris ou ↑ ↓ Entrée) l'ajoute à l'ordonnance, où l'on précise
 * posologie, durée et quantité. Aucun prix n'est affiché ni récupéré. Un médicament absent de la base peut être ajouté tel quel.
 */
export function ChampsMedicamentsOrdonnance() {
  const [terme, setTerme] = useState('');
  const [lignes, setLignes] = useState<LigneOrdonnanceSaisie[]>([]);
  const [resultats, setResultats] = useState<MedicamentCatalogue[]>([]);
  const [recherche, setRecherche] = useState<'repos' | 'en-cours' | 'vide'>('repos');
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const [avis, setAvis] = useState<string | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Numéro de la dernière recherche : une réponse tardive d'une frappe précédente est ignorée. */
  const sequence = useRef(0);
  const compteur = useRef(0);

  const saisieLibre = terme.trim().length >= 2 ? terme.trim() : null;
  /** Lignes du tableau : les médicaments trouvés puis, en dernier, « ajouter tel quel » (hors base). */
  const nbChoix = resultats.length + (saisieLibre ? 1 : 0);
  const tableauVisible = ouvert && terme.trim().length >= 2;
  const fermer = useCallback(() => setOuvert(false), []);
  useEchapFermeTableau(tableauVisible, fermer);

  function saisir(valeur: string) {
    setTerme(valeur);
    setOuvert(true);
    setAvis(null);
    clearTimeout(minuteur.current);
    const numero = ++sequence.current;
    if (valeur.trim().length < 2) {
      setResultats([]);
      setRecherche('repos');
      return;
    }
    setRecherche('en-cours');
    minuteur.current = setTimeout(async () => {
      const trouves = await rechercherMedicamentsCatalogue(valeur);
      if (numero !== sequence.current) return;
      setResultats(trouves);
      setActif(0);
      setRecherche(trouves.length > 0 ? 'repos' : 'vide');
    }, 250);
  }

  function ajouter(ligne: Omit<LigneOrdonnanceSaisie, 'cle' | 'posologie' | 'duree' | 'quantite'>) {
    if (ligne.medicamentId && lignes.some((l) => l.medicamentId === ligne.medicamentId)) {
      setAvis(`« ${ligne.medicament} » est déjà dans l’ordonnance.`);
    } else {
      compteur.current += 1;
      setLignes((ls) => [...ls, { ...ligne, cle: `l${compteur.current}`, posologie: '', duree: '', quantite: '1' }]);
      setAvis(null);
    }
    sequence.current++;
    clearTimeout(minuteur.current);
    setTerme('');
    setResultats([]);
    setRecherche('repos');
    setOuvert(false);
  }

  function choisir(i: number) {
    if (i < resultats.length) {
      const m = resultats[i];
      ajouter({ medicamentId: m.id, medicament: libelleMedicament(m), dosage: dosageMedicament(m) });
    } else if (saisieLibre) {
      ajouter({ medicamentId: null, medicament: saisieLibre, dosage: '' });
    }
  }

  function modifier(cle: string, champ: 'posologie' | 'duree' | 'quantite', valeur: string) {
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)));
  }

  function touche(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!tableauVisible || nbChoix === 0) {
      // Entrée dans le champ ne doit pas soumettre l'ordonnance par erreur
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActif((i) => (i + 1) % nbChoix);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActif((i) => (i <= 0 ? nbChoix - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choisir(actif);
    }
  }

  return (
    <div className="grid gap-4">
      <Champ
        label="Rechercher un médicament"
        htmlFor="champ-medicament"
        aide="Tapez les premières lettres (dénomination ou nom commercial) : les médicaments de la base du système s’affichent. Aucun prix n’est repris."
      >
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOuvert(false);
          }}
        >
          <Input
            id="champ-medicament"
            autoComplete="off"
            role="combobox"
            aria-expanded={tableauVisible}
            aria-controls="tableau-medicaments"
            aria-autocomplete="list"
            placeholder="Ex. paracétamol, amoxicilline…"
            value={terme}
            onChange={(e) => saisir(e.target.value)}
            onFocus={() => setOuvert(true)}
            onKeyDown={touche}
          />
          {tableauVisible && (
            <div
              id="tableau-medicaments"
              role="listbox"
              aria-label="Médicaments de la base"
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover text-sm text-popover-foreground shadow-md"
            >
              <div aria-hidden="true" className="sticky top-0 grid grid-cols-[1fr_auto] gap-3 border-b bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Médicament</span>
                <span className="w-40">Dosage · forme</span>
              </div>
              {recherche === 'en-cours' && <p className="px-3 py-2 text-xs text-muted-foreground">Recherche dans la base des médicaments…</p>}
              {recherche === 'vide' && <p className="px-3 py-2 text-xs text-muted-foreground">Aucun médicament de la base ne correspond.</p>}
              {resultats.map((m, i) => (
                <div
                  key={m.id}
                  role="option"
                  aria-selected={i === actif}
                  className={`grid cursor-pointer grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-1.5 ${i === actif ? 'bg-muted' : 'hover:bg-muted/60'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActif(i)}
                  onClick={() => choisir(i)}
                >
                  <span>{libelleMedicament(m)}</span>
                  <span className="w-40 text-xs text-muted-foreground">{dosageMedicament(m) || '—'}</span>
                </div>
              ))}
              {saisieLibre && (
                <div
                  role="option"
                  aria-selected={actif === resultats.length}
                  className={`cursor-pointer border-t px-3 py-1.5 text-xs ${actif === resultats.length ? 'bg-muted' : 'hover:bg-muted/60'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActif(resultats.length)}
                  onClick={() => choisir(resultats.length)}
                >
                  Ajouter « {saisieLibre} » tel quel (médicament hors base du système)
                </div>
              )}
            </div>
          )}
        </div>
      </Champ>
      {avis && <p className="text-xs text-destructive">{avis}</p>}

      <input type="hidden" name="lignes" value={JSON.stringify(lignes.map(({ cle: _cle, ...reste }) => reste))} />

      {lignes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun médicament pour l’instant : recherchez-en un ci-dessus.</p>
      ) : (
        <ul className="grid gap-3" aria-label="Médicaments de l’ordonnance">
          {lignes.map((l) => (
            <li key={l.cle} className="grid gap-2 rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{l.medicament}</p>
                  <p className="text-xs text-muted-foreground">{l.dosage || (l.medicamentId ? 'Dosage non renseigné' : 'Hors base du système')}</p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label={`Retirer ${l.medicament}`}
                  onClick={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_5rem]">
                <div className="grid gap-1">
                  <Label htmlFor={`posologie-${l.cle}`} className="text-xs">
                    Posologie <span className="text-destructive">*</span>
                  </Label>
                  <Input id={`posologie-${l.cle}`} maxLength={300} placeholder="1 cp x3/j" value={l.posologie} onChange={(e) => modifier(l.cle, 'posologie', e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`duree-${l.cle}`} className="text-xs">
                    Durée
                  </Label>
                  <Input id={`duree-${l.cle}`} maxLength={80} placeholder="5 jours" value={l.duree} onChange={(e) => modifier(l.cle, 'duree', e.target.value)} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`quantite-${l.cle}`} className="text-xs">
                    Quantité
                  </Label>
                  <Input id={`quantite-${l.cle}`} type="number" min={1} max={1000} value={l.quantite} onChange={(e) => modifier(l.cle, 'quantite', e.target.value)} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
