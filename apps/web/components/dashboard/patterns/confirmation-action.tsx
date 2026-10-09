'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Alerte } from './alerte';
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

/** Actions confirmées par ce composant (ADR-007). */
export type ActionConfirmee = 'supprimer' | 'archiver' | 'desarchiver';

/** Libellés des actions (titre, bouton, verbe, caractère définitif). */
export const LIBELLE_ACTION: Record<
  ActionConfirmee,
  { titre: string; bouton: string; verbe: string; definitif: boolean }
> = {
  supprimer: { titre: 'Supprimer', bouton: 'Supprimer', verbe: 'supprimer', definitif: true },
  archiver: { titre: 'Archiver', bouton: 'Archiver', verbe: 'archiver', definitif: false },
  desarchiver: { titre: 'Désarchiver', bouton: 'Désarchiver', verbe: 'désarchiver', definitif: false },
};

/** Verdict du serveur (`GET /api/v1/dependances/:entite/:id/:action`). */
export interface VerdictAction {
  possible: boolean;
  raison: string | null;
  liens: { type: string; libelle: string; nombre: number }[];
}

export type ResultatAction = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Confirmation PARTAGÉE des actions de suppression / archivage / désarchivage (ADR-007).
 *
 * À l'ouverture, demande au serveur si l'action est possible (`verifier`) : si non,
 * affiche la raison (avec les nombres d'éléments liés) et seulement « Fermer » ; si oui,
 * demande confirmation en NOMMANT l'élément. Le serveur reste juge : un refus survenu
 * entre-temps (409) est affiché tel quel. N'apparaît qu'aux rôles autorisés (l'appelant
 * masque le déclencheur sinon).
 */
export function ConfirmationAction({
  action,
  element,
  consequence,
  verifier,
  onConfirmer,
  onSucces,
  declencheur,
  libelles,
  motif,
}: {
  action: ActionConfirmee;
  /** Élément nommé, avec son type : « l’acte « CI-CONS-GEN — Consultation » ». */
  element: string;
  /** Précision affichée sous la question (effet de l'action). */
  consequence?: string;
  /** Vérification serveur à l'ouverture (« action possible ? »). */
  verifier?: () => Promise<VerdictAction | { erreur: string }>;
  /** `motif` : saisi dans la confirmation quand la prop `motif` est fournie (annulations). */
  onConfirmer: (motif?: string) => Promise<ResultatAction>;
  onSucces?: () => void;
  /** Bouton déclencheur (un bouton fantôme « Supprimer » par défaut). */
  declencheur?: React.ReactNode;
  /** Libellés propres à un cas particulier (ex. « Réactiver » un compte au lieu de « Désarchiver »). */
  libelles?: Partial<{ titre: string; bouton: string; verbe: string }>;
  /** Motif OBLIGATOIRE demandé dans la confirmation (annulation d'un avenant, d'une cotisation). */
  motif?: { libelle: string; minimum?: number };
}) {
  const libelle = { ...LIBELLE_ACTION[action], ...libelles };
  const [ouvert, setOuvert] = useState(false);
  const [verdict, setVerdict] = useState<VerdictAction | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [saisieMotif, setSaisieMotif] = useState('');
  const [verification, startVerification] = useTransition();
  const [execution, startExecution] = useTransition();

  const ouvrir = (v: boolean) => {
    setOuvert(v);
    if (!v) return;
    setVerdict(null);
    setErreur(null);
    setSaisieMotif('');
    if (verifier) {
      startVerification(async () => {
        const r = await verifier();
        if ('erreur' in r) setErreur(r.erreur);
        else setVerdict(r);
      });
    } else {
      setVerdict({ possible: true, raison: null, liens: [] });
    }
  };

  const confirmer = () =>
    startExecution(async () => {
      setErreur(null);
      const r = await onConfirmer(motif ? saisieMotif.trim() : undefined);
      if (r.ok) {
        setOuvert(false);
        onSucces?.();
      } else {
        setErreur(r.error);
      }
    });

  const impossible = verdict !== null && !verdict.possible;
  const minimumMotif = motif?.minimum ?? 5;
  const motifManquant = Boolean(motif) && saisieMotif.trim().length < minimumMotif;

  return (
    <Dialog open={ouvert} onOpenChange={ouvrir}>
      <DialogTrigger asChild>
        {declencheur ?? (
          <Button size="xs" variant="ghost">
            {libelle.bouton}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent side="center">
        <DialogHeader>
          <DialogTitle>
            {libelle.titre} {element}
          </DialogTitle>
          {!impossible && verdict && (
            <DialogDescription>
              Voulez-vous vraiment {libelle.verbe} {element} ?
              {consequence ? ` ${consequence}` : ''}
              {libelle.definitif ? ' Cette action est définitive.' : ''}
            </DialogDescription>
          )}
        </DialogHeader>

        {verification && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            Vérification des éléments liés…
          </p>
        )}
        {impossible && (
          <Alerte ton="avertissement" titre="Action impossible">
            {verdict.raison}
          </Alerte>
        )}
        {!impossible && verdict && motif && (
          <div className="space-y-1">
            <label htmlFor="motif-confirmation" className="text-sm font-medium">
              {motif.libelle} <span className="text-destructive">*</span>
            </label>
            <textarea
              id="motif-confirmation"
              name="motif"
              value={saisieMotif}
              onChange={(e) => setSaisieMotif(e.target.value)}
              maxLength={500}
              rows={3}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={`Obligatoire (${minimumMotif} caractères minimum) — conservé dans l'historique`}
            />
          </div>
        )}
        {erreur && <Alerte ton="erreur">{erreur}</Alerte>}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={execution}>
              {impossible ? 'Fermer' : 'Annuler'}
            </Button>
          </DialogClose>
          {!impossible && (
            <Button
              type="button"
              variant={action === 'supprimer' ? 'destructive' : 'default'}
              disabled={execution || verification || verdict === null || motifManquant}
              onClick={confirmer}
            >
              {execution && <Loader2 className="size-4 animate-spin" />}
              {libelle.bouton}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
