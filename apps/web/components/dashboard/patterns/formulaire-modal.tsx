'use client';

import { Plus } from 'lucide-react';
import * as React from 'react';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export type ResultatSoumission =
  | { ok: true; message?: string }
  | { ok: false; error: string; erreurs?: string[] };

/**
 * Wrapper générique des formulaires de création / édition, en panneau latéral
 * (mobile-first : plein écran sur mobile, drawer à droite sur desktop) ou en
 * modale centrée (`mode="center"`).
 *
 * - Champs passés en `children` (`ChampTexte`, `ChampSelect`… de ce même dossier).
 * - `onSoumettre(formData)` renvoie `{ ok }` :
 *     succès → ferme, réinitialise, `onSucces()` ;
 *     échec  → affiche `error` (+ liste `erreurs` de validation), reste ouvert.
 * - `ouvert` / `onOuvertChange` pour un pilotage contrôlé (édition d'une ligne).
 */
export function FormulaireModal({
  titre,
  description,
  declencheurLabel = 'Nouveau',
  declencheur,
  libelleSoumettre = 'Enregistrer',
  mode = 'right',
  ouvert: ouvertControle,
  onOuvertChange,
  children,
  onSoumettre,
  onSucces,
}: {
  titre: string;
  description?: string;
  declencheurLabel?: string;
  declencheur?: React.ReactNode;
  libelleSoumettre?: string;
  mode?: 'right' | 'center';
  ouvert?: boolean;
  onOuvertChange?: (v: boolean) => void;
  children: React.ReactNode;
  onSoumettre: (data: FormData) => Promise<ResultatSoumission>;
  onSucces?: (message?: string) => void;
}) {
  const [ouvertInterne, setOuvertInterne] = useState(false);
  const ouvert = ouvertControle ?? ouvertInterne;
  const setOuvert = (v: boolean) => {
    setOuvertInterne(v);
    onOuvertChange?.(v);
  };

  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(v) => {
        setOuvert(v);
        if (!v) {
          setErreur(null);
          setErreurs([]);
        }
      }}
    >
      {(declencheur || !ouvertControle) && (
        <DialogTrigger asChild>
          {declencheur ?? (
            <Button size="sm">
              <Plus className="size-4" />
              {declencheurLabel}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent side={mode}>
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <form
          key={ouvert ? 'ouvert' : 'ferme'}
          className="flex flex-1 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErreur(null);
            setErreurs([]);
            const data = new FormData(e.currentTarget);
            const form = e.currentTarget;
            start(async () => {
              const r = await onSoumettre(data);
              if (r.ok) {
                form.reset();
                setOuvert(false);
                onSucces?.(r.message);
              } else {
                setErreur(r.error);
                setErreurs(r.erreurs ?? []);
              }
            });
          }}
        >
          <div className="grid gap-4">{children}</div>

          {(erreur || erreurs.length > 0) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {erreur && <p className="font-medium">{erreur}</p>}
              {erreurs.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {erreurs.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : libelleSoumettre}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
