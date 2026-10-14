'use client';

import { Building2, CreditCard, ShieldCheck, ZoomIn } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { PatientDossier } from './dossier-detail';

const LIBELLE_LIEN: Record<string, string> = {
  TITULAIRE: 'Adhérent titulaire',
  CONJOINT: 'Conjoint(e)',
  ENFANT: 'Enfant',
  PERE: 'Père',
  MERE: 'Mère',
  AUTRE: 'Autre bénéficiaire',
};

const LIBELLE_SEXE: Record<string, string> = { M: 'Masculin', F: 'Féminin' };

function age(dateNaissance: string): number {
  const n = new Date(dateNaissance);
  const auj = new Date();
  let a = auj.getFullYear() - n.getFullYear();
  if (auj.getMonth() < n.getMonth() || (auj.getMonth() === n.getMonth() && auj.getDate() < n.getDate())) a -= 1;
  return a;
}

/**
 * Identité du patient, à l'extrême gauche de la carte « Informations » : photo agrandie (un clic l'ouvre en grand), nom,
 * date de naissance, lien et sexe, n° de carte, formule.
 */
export function FichePatient({ patient, compact = false }: { patient: PatientDossier; compact?: boolean }) {
  const taillePhoto = compact ? 'size-28' : 'size-40';
  const nomComplet = `${patient.prenom} ${patient.nom}`;
  const initiales = `${patient.prenom.charAt(0)}${patient.nom.charAt(0)}`.toUpperCase();
  const lien = LIBELLE_LIEN[patient.lien] ?? patient.lien;
  const sexe = patient.sexe ? (LIBELLE_SEXE[patient.sexe] ?? patient.sexe) : null;

  return (
    <div className={`flex shrink-0 items-center border-b sm:border-b-0 sm:border-r sm:pb-0 ${compact ? 'gap-3 pb-2 sm:w-[26rem] sm:pr-4' : 'gap-4 pb-3 sm:w-[30rem] sm:pr-5'}`}>
      {patient.photoUrl ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className={`group relative ${taillePhoto} shrink-0 overflow-hidden rounded-xl ring-1 ring-border focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}
              aria-label={`Agrandir la photo de ${nomComplet}`}
              title="Cliquer pour agrandir"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URL signée du stockage privé, hors optimiseur d'images */}
              <img src={patient.photoUrl} alt={`Photo de ${nomComplet}`} className="size-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/50 py-0.5 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <ZoomIn aria-hidden="true" className="size-3" /> Agrandir
              </span>
            </button>
          </DialogTrigger>
          <DialogContent side="center" className="w-auto max-w-[min(92vw,640px)] p-3">
            <DialogTitle className="sr-only">Photo de {nomComplet}</DialogTitle>
            <DialogDescription className="sr-only">Photo du patient, en grand.</DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element -- URL signée du stockage privé, hors optimiseur d'images */}
            <img src={patient.photoUrl} alt={`Photo de ${nomComplet}`} className="max-h-[80vh] w-full rounded-lg object-contain" />
            <p className="pt-1 text-center text-sm font-medium">{nomComplet}</p>
          </DialogContent>
        </Dialog>
      ) : (
        <span
          aria-hidden
          className={`flex ${taillePhoto} shrink-0 items-center justify-center rounded-xl bg-primary/10 ${compact ? 'text-2xl' : 'text-3xl'} font-semibold text-primary ring-1 ring-border`}
        >
          {initiales}
        </span>
      )}

      <div className={`min-w-0 ${compact ? 'space-y-0.5' : 'space-y-1'}`}>
        <p className="truncate text-lg font-semibold leading-tight">
          {patient.prenom} <span className="uppercase">{patient.nom}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Né(e) le {new Date(patient.dateNaissance).toLocaleDateString('fr-FR')} · {age(patient.dateNaissance)} ans
        </p>
        <p className="text-sm text-muted-foreground">
          {lien} · {sexe ?? 'sexe non renseigné'}
        </p>
        {patient.societe && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground" title="Société de l’adhérent">
            <Building2 aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate text-foreground">{patient.societe}</span>
          </p>
        )}
        {patient.numeroCarte && (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <CreditCard aria-hidden="true" className="size-3.5 shrink-0" />
            Carte <span className="font-mono text-foreground">{patient.numeroCarte}</span>
          </p>
        )}
        {patient.formule && (
          <p className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary">
            <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate" title={`Formule d’assurance : ${patient.formule}`}>
              {/^formule\b/i.test(patient.formule) ? patient.formule : `Formule ${patient.formule}`}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
