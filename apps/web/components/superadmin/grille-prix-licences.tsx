'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { definirPrixLicence } from '@/app/superadmin/licences/historique/actions';
import { Button } from '@/components/ui/button';

export interface TarifLicence {
  valeur: string;
  libelle: string;
  duree: string;
  prix: number;
}

function Ligne({ t }: { t: TarifLicence }) {
  const router = useRouter();
  const [valeur, setValeur] = useState(String(t.prix));
  const [pending, startTransition] = useTransition();
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const nombre = Number(valeur);
  const inchange = nombre === t.prix;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium">{t.libelle}</p>
        <p className="text-xs text-muted-foreground">{t.duree}</p>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Prix (FCFA)
        <input
          type="number"
          min={0}
          step={1000}
          inputMode="numeric"
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          aria-label={`Prix de ${t.libelle}`}
          className="h-9 w-40 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums"
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || inchange || valeur === '' || !Number.isFinite(nombre) || nombre < 0}
        onClick={() =>
          startTransition(async () => {
            const res = await definirPrixLicence(t.valeur, nombre);
            setRetour({ ok: res.ok, texte: res.ok ? res.message : res.error });
            if (res.ok) router.refresh();
          })
        }
      >
        Enregistrer
      </Button>
      {retour && <span className={`text-xs ${retour.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>{retour.texte}</span>}
    </li>
  );
}

/** Grille de prix des licences : modifiable par le superadmin ; un changement ne touche que les licences générées ensuite. */
export function GrillePrixLicences({ tarifs }: { tarifs: TarifLicence[] }) {
  return (
    <ul className="space-y-2" aria-label="Prix des licences">
      {tarifs.map((t) => (
        <Ligne key={t.valeur} t={t} />
      ))}
    </ul>
  );
}
