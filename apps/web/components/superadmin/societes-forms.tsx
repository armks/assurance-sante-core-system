'use client';

import { useState, useTransition } from 'react';

import {
  creerOrganisation,
  inviterPremierCompte,
  type ResultatAction,
} from '@/app/superadmin/societes/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Message({ res }: { res: ResultatAction | null }) {
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

export function CreerSocieteForm() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ResultatAction | null>(null);

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const form = e.currentTarget;
        start(async () => {
          const r = await creerOrganisation({
            nom: String(f.get('nom') ?? ''),
            type: f.get('type') === 'MUTUELLE' ? 'MUTUELLE' : 'ASSUREUR',
            pays: String(f.get('pays') ?? ''),
            devise: String(f.get('devise') ?? 'XOF'),
          });
          setRes(r);
          if (r.ok) form.reset();
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="nom">Nom</Label>
        <Input id="nom" name="nom" required placeholder="Nouvelle Mutuelle CI" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="type">Type</Label>
        <select
          id="type"
          name="type"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          defaultValue="ASSUREUR"
        >
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
      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Création…' : 'Créer l’organisation'}
        </Button>
        <Message res={res} />
      </div>
    </form>
  );
}

export function InviterPremierCompteForm({
  organisationId,
  organisationNom,
}: {
  organisationId: string;
  organisationNom: string;
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ResultatAction | null>(null);

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const form = e.currentTarget;
        start(async () => {
          const r = await inviterPremierCompte({
            organisationId,
            email: String(f.get('email') ?? ''),
            rolePropose:
              f.get('role') === 'ASSUREUR_DIRECTION'
                ? 'ASSUREUR_DIRECTION'
                : 'ASSUREUR_INFORMATIQUE',
          });
          setRes(r);
          if (r.ok) form.reset();
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`email-${organisationId}`}>
          E-mail du premier compte de « {organisationNom} »
        </Label>
        <Input
          id={`email-${organisationId}`}
          name="email"
          type="email"
          required
          placeholder="direction@societe.ci"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`role-${organisationId}`}>Rôle</Label>
        <select
          id={`role-${organisationId}`}
          name="role"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          defaultValue="ASSUREUR_INFORMATIQUE"
        >
          <option value="ASSUREUR_INFORMATIQUE">Assurance Informatique</option>
          <option value="ASSUREUR_DIRECTION">Assurance de Direction</option>
        </select>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Envoi…' : 'Inviter'}
      </Button>
      <div className="sm:col-span-3">
        <Message res={res} />
      </div>
    </form>
  );
}
