'use client';

import { useState, useTransition } from 'react';

import {
  confirmerAction,
  initierCreationOrganisation,
  initierProlongation,
  initierSuspension,
  type ResultatConfirmation,
  type ResultatInitiation,
} from '@/app/superadmin/societes/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CHAMP_SELECT =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm';

function Msg({
  res,
}: {
  res: { ok: boolean; message?: string; error?: string } | null;
}) {
  if (!res) return null;
  return (
    <p
      className={
        res.ok
          ? 'text-sm text-emerald-700 dark:text-emerald-400'
          : 'text-sm text-destructive'
      }
    >
      {res.ok ? res.message : res.error}
    </p>
  );
}

/**
 * Panneau de l'étape 2 : saisie du code reçu par e-mail. `onConfirm` exécute
 * réellement l'action côté serveur.
 */
function PanneauCode({
  info,
  onConfirm,
  onAnnuler,
}: {
  info: string;
  onConfirm: (code: string) => Promise<ResultatConfirmation>;
  onAnnuler: () => void;
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ResultatConfirmation | null>(null);

  return (
    <div className="rounded-lg border border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <p className="text-sm font-medium">Vérifiez votre e-mail</p>
      <p className="mt-1 text-sm text-muted-foreground">{info}</p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const code = String(new FormData(e.currentTarget).get('code') ?? '');
          start(async () => {
            const r = await onConfirm(code);
            setRes(r);
          });
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="code-confirmation">Code de confirmation</Label>
          <Input
            id="code-confirmation"
            name="code"
            required
            autoComplete="one-time-code"
            placeholder="8 caractères"
            className="w-40 font-mono tracking-widest uppercase"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Confirmation…' : 'Confirmer'}
        </Button>
        <Button type="button" variant="ghost" onClick={onAnnuler} disabled={pending}>
          Annuler
        </Button>
      </form>
      <div className="mt-2">
        <Msg res={res} />
      </div>
    </div>
  );
}

export function CreerSocieteFlow() {
  const [pending, start] = useTransition();
  const [initiation, setInitiation] = useState<ResultatInitiation | null>(null);

  if (initiation?.ok) {
    return (
      <PanneauCode
        info={initiation.message}
        onConfirm={confirmerAction}
        onAnnuler={() => setInitiation(null)}
      />
    );
  }

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await initierCreationOrganisation({
            nom: String(f.get('nom') ?? ''),
            codeAssureur: String(f.get('codeAssureur') ?? '').trim() || undefined,
            type: f.get('type') === 'MUTUELLE' ? 'MUTUELLE' : 'ASSUREUR',
            pays: String(f.get('pays') ?? ''),
            devise: String(f.get('devise') ?? 'XOF'),
            plan:
              (f.get('plan') as 'STARTER' | 'BUSINESS' | 'ENTERPRISE') ??
              'STARTER',
            premierCompteEmail: String(f.get('premierCompteEmail') ?? ''),
            premierCompteRole:
              f.get('premierCompteRole') === 'ASSUREUR_DIRECTION'
                ? 'ASSUREUR_DIRECTION'
                : 'ASSUREUR_INFORMATIQUE',
          });
          setInitiation(r);
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="nom">Nom</Label>
        <Input id="nom" name="nom" required placeholder="Nouvelle Mutuelle CI" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="codeAssureur">Code assureur</Label>
        <Input
          id="codeAssureur"
          name="codeAssureur"
          inputMode="numeric"
          pattern="[0-9]{3,8}"
          maxLength={8}
          placeholder="3 à 8 chiffres — vide : attribué automatiquement"
          title="Numéro unique de l’assureur : 3 à 8 chiffres"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="type">Type</Label>
        <select id="type" name="type" className={CHAMP_SELECT} defaultValue="ASSUREUR">
          <option value="ASSUREUR">Assureur</option>
          <option value="MUTUELLE">Mutuelle</option>
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pays">Pays</Label>
        <Input id="pays" name="pays" required defaultValue="Côte d’Ivoire" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="devise">Devise</Label>
        <Input id="devise" name="devise" defaultValue="XOF" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="plan">Plan de licence</Label>
        <select id="plan" name="plan" className={CHAMP_SELECT} defaultValue="STARTER">
          <option value="STARTER">Starter</option>
          <option value="BUSINESS">Business</option>
          <option value="ENTERPRISE">Enterprise</option>
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="premierCompteRole">Rôle du premier compte</Label>
        <select
          id="premierCompteRole"
          name="premierCompteRole"
          className={CHAMP_SELECT}
          defaultValue="ASSUREUR_INFORMATIQUE"
        >
          <option value="ASSUREUR_INFORMATIQUE">Assurance Informatique</option>
          <option value="ASSUREUR_DIRECTION">Assurance de Direction</option>
        </select>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="premierCompteEmail">E-mail du premier compte</Label>
        <Input
          id="premierCompteEmail"
          name="premierCompteEmail"
          type="email"
          required
          placeholder="direction@societe.ci"
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Envoi du code…' : 'Soumettre'}
        </Button>
        {initiation && !initiation.ok && <Msg res={initiation} />}
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Cette action est confirmée en deux étapes : un code est envoyé à l’adresse
        du superadministrateur, à saisir ensuite pour créer réellement
        l’organisation.
      </p>
    </form>
  );
}

export function ActionsLicence({
  organisationId,
  organisationNom,
}: {
  organisationId: string;
  organisationNom: string;
}) {
  const [pending, start] = useTransition();
  const [initiation, setInitiation] = useState<
    (ResultatInitiation & { quoi: string }) | null
  >(null);

  if (initiation?.ok) {
    return (
      <PanneauCode
        info={`${initiation.message} (${initiation.quoi} de « ${organisationNom} »)`}
        onConfirm={confirmerAction}
        onAnnuler={() => setInitiation(null)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await initierSuspension(organisationId);
            setInitiation({ ...r, quoi: 'suspension' } as ResultatInitiation & {
              quoi: string;
            });
          })
        }
      >
        Suspendre
      </Button>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const d = String(new FormData(e.currentTarget).get('dateFin') ?? '');
          start(async () => {
            const r = await initierProlongation(organisationId, d);
            setInitiation({ ...r, quoi: 'prolongation' } as ResultatInitiation & {
              quoi: string;
            });
          });
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={`fin-${organisationId}`} className="text-xs">
            Prolonger jusqu’au
          </Label>
          <Input
            id={`fin-${organisationId}`}
            name="dateFin"
            type="date"
            required
            className="w-40"
          />
        </div>
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>
          Prolonger
        </Button>
      </form>
      {initiation && !initiation.ok && <Msg res={initiation} />}
    </div>
  );
}
