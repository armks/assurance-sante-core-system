'use client';

import { useEffect, useState } from 'react';

import { chargerCreneaux } from '@/app/rendez-vous-actions';
import { aujourdhui, heureRdv, jourCourt, type JourCreneaux } from '@/lib/rendez-vous';
import { cn } from '@/lib/utils';

const ajouterJours = (jour: string, n: number) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Choix d'un créneau libre dans l'agenda d'un médecin : à partir d'une date, les 14 jours suivants sont affichés avec leurs créneaux
 * disponibles (jamais un créneau pris, passé ou en absence). La valeur choisie est portée par un champ caché `debut`.
 */
export function SelecteurCreneau({ medecinId, sauf, name = 'debut', onChoisir }: { medecinId: string | null; sauf?: string; name?: string; onChoisir?: (debut: string) => void }) {
  const [depuis, setDepuis] = useState(aujourdhui());
  const [jours, setJours] = useState<JourCreneaux[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [choisi, setChoisi] = useState('');

  useEffect(() => {
    setChoisi('');
    setJours(null);
    setErreur(null);
    if (!medecinId || !depuis) return;
    let annule = false;
    void chargerCreneaux(medecinId, depuis, ajouterJours(depuis, 13), sauf).then((r) => {
      if (annule) return;
      if (r.ok) setJours(r.data);
      else setErreur(r.error);
    });
    return () => {
      annule = true;
    };
  }, [medecinId, depuis, sauf]);

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={choisi} />
      <label className="block space-y-1 text-sm font-medium">
        À partir du
        <input
          type="date"
          value={depuis}
          min={aujourdhui()}
          onChange={(e) => setDepuis(e.target.value)}
          className="block h-9 w-full rounded-md border bg-background px-3 text-sm font-normal"
        />
      </label>
      {!medecinId && <p className="text-sm text-muted-foreground">Choisissez d’abord un médecin.</p>}
      {medecinId && jours === null && !erreur && <p className="text-sm text-muted-foreground">Chargement des créneaux…</p>}
      {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
      {jours?.length === 0 && <p className="text-sm text-muted-foreground">Aucun créneau libre sur ces 14 jours : le médecin n’a pas renseigné de disponibilité, ou tout est pris.</p>}
      <div className="max-h-60 space-y-2 overflow-y-auto">
        {jours?.map((j) => (
          <div key={j.date}>
            <p className="mb-1 text-xs font-semibold capitalize text-muted-foreground">{jourCourt(`${j.date}T00:00:00Z`)}</p>
            <div className="flex flex-wrap gap-1.5">
              {j.creneaux.map((c) => (
                <button
                  key={c.debut}
                  type="button"
                  onClick={() => {
                    setChoisi(c.debut);
                    onChoisir?.(c.debut);
                  }}
                  aria-pressed={choisi === c.debut}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-sm tabular-nums transition-colors',
                    choisi === c.debut ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {heureRdv(c.debut)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {choisi && (
        <p className="text-sm">
          Créneau choisi : <strong>{jourCourt(choisi)} à {heureRdv(choisi)}</strong>
        </p>
      )}
    </div>
  );
}
