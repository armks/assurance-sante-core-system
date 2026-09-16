'use client';

import { useState, useTransition } from 'react';

import {
  creerEtablissement,
  creerPharmacie,
  modifierEtablissement,
  modifierPharmacie,
  rechercheGeolocalisee,
  reverifierObsoletes,
  supprimerEtablissement,
  supprimerPharmacie,
  validerEtablissement,
  type ResultatRechercheGeo,
  type ResultatReseau,
} from '@/app/dashboard-assureur/informatique/reseau-actions';
import {
  ChampCheckbox,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  FormulaireModal,
  StatutBadge,
} from '@/components/dashboard/patterns';
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
  verificationStatut: string | null;
  dateDerniereVerification: string | null;
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
  const [resVerif, setResVerif] = useState<ResultatReseau | null>(null);
  const [resGeo, setResGeo] = useState<
    { ok: true; resultat: ResultatRechercheGeo } | { ok: false; error: string } | null
  >(null);
  const [pendingGeo, startGeo] = useTransition();
  const estEtab = kind === 'etablissements';
  const aReverifier = lieux.filter(
    (l) => l.verificationStatut === 'A_REVERIFIER',
  ).length;

  return (
    <div className="space-y-10">
      {aReverifier > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300/70 bg-amber-50/60 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
          <span className="text-amber-800 dark:text-amber-300">
            {aReverifier} {estEtab ? 'établissement' : 'pharmacie'}
            {aReverifier > 1 ? 's' : ''} à revérifier (non vérifié·e·s depuis plus
            de 12 mois).
          </span>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Recherche géolocalisée
        </h2>
        <form
          className="grid gap-3 sm:grid-cols-[8rem_8rem_8rem_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const lat = num(f.get('lat'));
            const lng = num(f.get('lng'));
            if (lat === undefined || lng === undefined) return;
            startGeo(async () => {
              setResGeo(
                await rechercheGeolocalisee({
                  lat,
                  lng,
                  rayonKm: num(f.get('rayonKm')),
                  cible: String(f.get('cible') ?? 'TOUS') as
                    | 'ETABLISSEMENTS'
                    | 'PHARMACIES'
                    | 'TOUS',
                }),
              );
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="lat">Latitude</Label>
            <Input id="lat" name="lat" required inputMode="decimal" placeholder="5.32" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lng">Longitude</Label>
            <Input id="lng" name="lng" required inputMode="decimal" placeholder="-4.02" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rayonKm">Rayon (km)</Label>
            <Input id="rayonKm" name="rayonKm" inputMode="decimal" defaultValue="5" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cible">Cible</Label>
            <select
              id="cible"
              name="cible"
              defaultValue="TOUS"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="TOUS">Tout le réseau</option>
              <option value="ETABLISSEMENTS">Établissements</option>
              <option value="PHARMACIES">Pharmacies</option>
            </select>
          </div>
          <Button type="submit" variant="outline" disabled={pendingGeo}>
            {pendingGeo ? 'Recherche…' : 'Rechercher'}
          </Button>
        </form>
        {resGeo && !resGeo.ok && (
          <p className="text-sm text-destructive">{resGeo.error}</p>
        )}
        {resGeo?.ok && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Nom</th>
                  <th className="px-3 py-2 font-medium">Ville</th>
                  <th className="px-3 py-2 font-medium">Distance</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...(resGeo.resultat.etablissements ?? []).map((r) => ({
                    ...r,
                    type: 'Établissement',
                  })),
                  ...(resGeo.resultat.pharmacies ?? []).map((r) => ({
                    ...r,
                    type: 'Pharmacie',
                  })),
                ]
                  .sort((a, b) => a.distanceKm - b.distanceKm)
                  .map((r) => (
                    <tr key={`${r.type}-${r.id}`} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{r.type}</td>
                      <td className="px-3 py-2">{r.nom}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {[r.commune, r.ville].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-3 py-2">{r.distanceKm.toFixed(2)} km</td>
                    </tr>
                  ))}
                {(resGeo.resultat.etablissements?.length ?? 0) === 0 &&
                  (resGeo.resultat.pharmacies?.length ?? 0) === 0 && (
                    <tr className="border-t">
                      <td
                        className="px-3 py-6 text-center text-muted-foreground"
                        colSpan={4}
                      >
                        Aucun établissement ni pharmacie ACTIF dans ce rayon.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Vérification périodique du réseau
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => setResVerif(await reverifierObsoletes()))
            }
          >
            Marquer les entrées obsolètes
          </Button>
        </div>
        <Message res={resVerif} />
      </section>

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
              adresseComplete:
                String(f.get('adresseComplete') ?? '') || undefined,
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
          <div className="grid gap-2 sm:col-span-3">
            <Label htmlFor="adresseComplete">Adresse complète</Label>
            <Input
              id="adresseComplete"
              name="adresseComplete"
              placeholder="Rue / boulevard, repère… (géocodage automatique si latitude/longitude non fournies)"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="telephone">Téléphone</Label>
            <Input id="telephone" name="telephone" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="latitude">Latitude</Label>
            <Input id="latitude" name="latitude" inputMode="decimal" placeholder="auto si vide" />
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
                  <th className="px-3 py-2 font-medium">Vérif.</th>
                  <th className="px-3 py-2 font-medium">Géo</th>
                  <th className="px-3 py-2" />
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
                    <td className="px-3 py-2">
                      {l.verificationStatut === 'A_REVERIFIER' ? (
                        <StatutBadge
                          statut="A_REVERIFIER"
                          ton="attention"
                          libelle="À revérifier"
                        />
                      ) : l.verificationStatut ? (
                        <StatutBadge
                          statut={l.verificationStatut}
                          ton={
                            l.verificationStatut === 'ACTIF' ? 'succes' : 'danger'
                          }
                          libelle={l.verificationStatut.toLowerCase()}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          jamais vérifié
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {l.latitude != null && l.longitude != null
                        ? `${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="flex justify-end gap-2">
                        {estEtab && l.statut === 'EN_ATTENTE_VALIDATION' && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              start(async () =>
                                setRes(await validerEtablissement(l.id)),
                              )
                            }
                          >
                            Valider
                          </Button>
                        )}
                        <FormulaireModal
                          titre={estEtab ? "Modifier l'établissement" : 'Modifier la pharmacie'}
                          declencheur={
                            <Button type="button" size="xs" variant="ghost">
                              Modifier
                            </Button>
                          }
                          libelleSoumettre="Enregistrer"
                          onSoumettre={async (fd) => {
                            const input = {
                              nom: String(fd.get('nom') ?? '') || undefined,
                              ville: String(fd.get('ville') ?? '') || undefined,
                              commune: String(fd.get('commune') ?? '') || undefined,
                              adresseComplete:
                                String(fd.get('adresseComplete') ?? '') || undefined,
                              telephone:
                                String(fd.get('telephone') ?? '') || undefined,
                              gardeWeekend: fd.get('gardeWeekend') === 'on',
                            };
                            const r = estEtab
                              ? await modifierEtablissement(l.id, {
                                  ...input,
                                  typeEtablissement:
                                    String(fd.get('typeEtablissement') ?? '') ||
                                    undefined,
                                })
                              : await modifierPharmacie(l.id, input);
                            return r.ok
                              ? { ok: true, message: r.message }
                              : { ok: false, error: r.error };
                          }}
                        >
                          <ChampTexte name="nom" label="Nom" required defaultValue={l.nom} />
                          {estEtab && (
                            <ChampSelect
                              name="typeEtablissement"
                              label="Type"
                              defaultValue={l.typeEtablissement}
                              options={TYPES_ETABLISSEMENT.map((t) => ({
                                valeur: t,
                                libelle: t.replaceAll('_', ' ').toLowerCase(),
                              }))}
                            />
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <ChampTexte
                              name="ville"
                              label="Ville"
                              defaultValue={l.ville ?? undefined}
                            />
                            <ChampTexte
                              name="commune"
                              label="Commune"
                              defaultValue={l.commune ?? undefined}
                            />
                          </div>
                          <ChampTexte
                            name="adresseComplete"
                            label="Adresse complète"
                          />
                          <ChampTexte name="telephone" label="Téléphone" />
                          <ChampCheckbox
                            name="gardeWeekend"
                            label="Garde le week-end"
                            defaultChecked={l.gardeWeekend}
                          />
                        </FormulaireModal>
                        <FormulaireModal
                          titre={estEtab ? "Supprimer l'établissement" : 'Supprimer la pharmacie'}
                          mode="center"
                          declencheur={
                            <Button type="button" size="xs" variant="ghost">
                              Supprimer
                            </Button>
                          }
                          libelleSoumettre="Supprimer"
                          onSoumettre={async () => {
                            const r = estEtab
                              ? await supprimerEtablissement(l.id)
                              : await supprimerPharmacie(l.id);
                            return r.ok
                              ? { ok: true, message: 'Supprimé.' }
                              : { ok: false, error: r.error };
                          }}
                        >
                          <p className="text-sm text-muted-foreground">
                            « {l.nom} » sera retiré du réseau. Action tracée
                            dans l’audit.
                          </p>
                        </FormulaireModal>
                      </span>
                    </td>
                  </tr>
                ))}
                {lieux.length === 0 && (
                  <tr className="border-t">
                    <td
                      className="px-3 py-6 text-center text-muted-foreground"
                      colSpan={estEtab ? 8 : 7}
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
