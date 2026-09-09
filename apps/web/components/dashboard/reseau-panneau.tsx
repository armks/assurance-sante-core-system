'use client';

import { useState, useTransition } from 'react';

import {
  creerEtablissement,
  creerPharmacie,
  type ResultatReseau,
} from '@/app/dashboard-assureur/informatique/reseau-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TYPES_ETABLISSEMENT = [
  'HOPITAL_PUBLIC',
  'CLINIQUE_PRIVEE',
  'CABINET_MEDICAL',
  'CENTRE_SANTE',
  'LABORATOIRE',
  'CENTRE_IMAGERIE',
  'OPTICIEN',
  'DENTISTE',
  'MATERNITE',
];

export interface LieuReseau {
  id: string;
  nom: string;
  code: string;
  typeEtablissement?: string;
  ville: string | null;
  commune: string | null;
  statut: string;
  gardeWeekend: boolean;
  latitude: number | null;
  longitude: number | null;
}

function Message({ res }: { res: ResultatReseau | null }) {
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

function num(v: FormDataEntryValue | null): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function ReseauPanneau({
  kind,
  lieux,
  erreur,
}: {
  kind: 'etablissements' | 'pharmacies';
  lieux: LieuReseau[];
  erreur: string | null;
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ResultatReseau | null>(null);
  const estEtab = kind === 'etablissements';

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {estEtab ? 'Nouvel établissement' : 'Nouvelle pharmacie'}
        </h2>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            const base = {
              nom: String(f.get('nom') ?? ''),
              code: String(f.get('code') ?? ''),
              ville: String(f.get('ville') ?? '') || undefined,
              commune: String(f.get('commune') ?? '') || undefined,
              telephone: String(f.get('telephone') ?? '') || undefined,
              latitude: num(f.get('latitude')),
              longitude: num(f.get('longitude')),
              gardeWeekend: f.get('gardeWeekend') === 'on',
            };
            start(async () => {
              const r = estEtab
                ? await creerEtablissement({
                    ...base,
                    typeEtablissement: String(f.get('typeEtablissement') ?? ''),
                  })
                : await creerPharmacie(base);
              setRes(r);
              if (r.ok) form.reset();
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="nom">Nom</Label>
            <Input id="nom" name="nom" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" required placeholder="Unique" />
          </div>
          {estEtab && (
            <div className="grid gap-2">
              <Label htmlFor="typeEtablissement">Type</Label>
              <select
                id="typeEtablissement"
                name="typeEtablissement"
                required
                defaultValue=""
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="" disabled>
                  Choisir…
                </option>
                {TYPES_ETABLISSEMENT.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll('_', ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="ville">Ville</Label>
            <Input id="ville" name="ville" defaultValue="Abidjan" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="commune">Commune</Label>
            <Input id="commune" name="commune" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="telephone">Téléphone</Label>
            <Input id="telephone" name="telephone" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="latitude">Latitude</Label>
            <Input id="latitude" name="latitude" inputMode="decimal" placeholder="5.35" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="longitude">Longitude</Label>
            <Input id="longitude" name="longitude" inputMode="decimal" placeholder="-4.01" />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="gardeWeekend" className="size-4" />
            Garde le week-end
          </label>
          <div className="sm:col-span-3 flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Créer'}
            </Button>
            <Message res={res} />
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {lieux.length} {estEtab ? 'établissement' : 'pharmacie'}
          {lieux.length > 1 ? 's' : ''}
        </h2>
        {erreur ? (
          <p className="text-sm text-destructive">{erreur}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Nom</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  {estEtab && <th className="px-3 py-2 font-medium">Type</th>}
                  <th className="px-3 py-2 font-medium">Ville</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 font-medium">Géo</th>
                </tr>
              </thead>
              <tbody>
                {lieux.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2">
                      {l.nom}
                      {l.gardeWeekend && (
                        <Badge variant="muted" className="ml-2">
                          garde WE
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{l.code}</td>
                    {estEtab && (
                      <td className="px-3 py-2 text-muted-foreground">
                        {(l.typeEtablissement ?? '')
                          .replaceAll('_', ' ')
                          .toLowerCase()}
                      </td>
                    )}
                    <td className="px-3 py-2 text-muted-foreground">
                      {[l.commune, l.ville].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          l.statut === 'ACTIF' || l.statut === 'ACTIVE'
                            ? 'success'
                            : 'outline'
                        }
                      >
                        {l.statut}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {l.latitude != null && l.longitude != null
                        ? `${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
                {lieux.length === 0 && (
                  <tr className="border-t">
                    <td
                      className="px-3 py-6 text-center text-muted-foreground"
                      colSpan={estEtab ? 6 : 5}
                    >
                      Aucune entrée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
