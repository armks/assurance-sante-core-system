'use client';

import { Activity, MapPin, MoonStar, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  creerEtablissement,
  creerPharmacie,
  modifierEtablissement,
  modifierPharmacie,
  rechercheGeolocalisee,
  reverifierObsoletes,
  changerArchivageLieu,
  supprimerEtablissement,
  supprimerPharmacie,
  validerEtablissement,
  type ResultatRechercheGeo,
  type ResultatReseau,
} from '@/app/dashboard-assureur/informatique/reseau-actions';
import { verifierAction, type VerdictsListe } from '@/app/dependances-actions';
import { ToutReactiver, type CompteDesactiveResume } from '@/components/dashboard/tout-reactiver';
import {
  CarteResume,
  GrilleCartes,
  ChampCheckbox,
  ConfirmationAction,
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
import {
  LIBELLE_STATUT_LIEU,
  LIBELLE_TYPE_ETABLISSEMENT,
  LIBELLE_VERIFICATION,
  OPTIONS_CATEGORIE_ETABLISSEMENT,
  TYPES_ETABLISSEMENT,
  libelleCategorieEtablissement,
  libelleTypeEtablissement,
} from '@/lib/reseau';

export interface LieuReseau {
  id: string;
  nom: string;
  code: string;
  typeEtablissement?: string;
  categorieEtablissement?: string;
  ville: string | null;
  commune: string | null;
  quartier?: string | null;
  adresseComplete?: string | null;
  telephone?: string | null;
  email?: string | null;
  statut: string;
  gardeWeekend: boolean;
  latitude: number | null;
  longitude: number | null;
  verificationStatut: string | null;
  dateDerniereVerification: string | null;
}

const CLASSE_FILTRE =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

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
  lieux: tousLesLieux,
  erreur,
  verdicts = {},
  desactives = {},
  peutReactiver = false,
}: {
  kind: 'etablissements' | 'pharmacies';
  lieux: LieuReseau[];
  erreur: string | null;
  /** Verdicts « action possible ? » par lieu (boutons grisés avec la raison). */
  verdicts?: VerdictsListe;
  /** Comptes désactivés par l'archivage, par lieu (boutons « Tout réactiver »). */
  desactives?: Record<string, CompteDesactiveResume[]>;
  peutReactiver?: boolean;
}) {
  const router = useRouter();
  const [voirArchives, setVoirArchives] = useState(false);
  const estArchive = (l: LieuReseau) => l.statut === 'RESILIE' || l.statut === 'RESILIEE';
  const nbArchives = tousLesLieux.filter(estArchive).length;
  const base = voirArchives ? tousLesLieux : tousLesLieux.filter((l) => !estArchive(l));
  const [q, setQ] = useState('');
  const [fStatut, setFStatut] = useState('');
  const [fCategorie, setFCategorie] = useState('');
  const [fVerif, setFVerif] = useState('');
  const lieux = base.filter((l) => {
    const mot = q.trim().toLowerCase();
    if (mot && !`${l.nom} ${l.code} ${l.ville ?? ''} ${l.commune ?? ''} ${l.quartier ?? ''}`.toLowerCase().includes(mot)) return false;
    if (fStatut && l.statut !== fStatut) return false;
    if (fCategorie && l.categorieEtablissement !== fCategorie) return false;
    if (fVerif === 'A_REVERIFIER' && l.verificationStatut !== 'A_REVERIFIER') return false;
    if (fVerif === 'JAMAIS' && l.verificationStatut) return false;
    return true;
  });
  const filtresActifs = Boolean(q || fStatut || fCategorie || fVerif);
  const nbActifs = lieux.filter((l) => l.statut === 'ACTIF' || l.statut === 'ACTIVE').length;
  const nbGarde = lieux.filter((l) => l.gardeWeekend).length;
  const nbSansPosition = lieux.filter((l) => l.latitude == null || l.longitude == null).length;
  const statutsPresents = [...new Set(tousLesLieux.map((l) => l.statut))];
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
        <GrilleCartes>
          <CarteResume libelle={estEtab ? 'Établissements' : 'Pharmacies'} valeur={lieux.length} icon={estEtab ? Stethoscope : Activity} indice={`${nbActifs} actif(s)`} />
          <CarteResume libelle="À revérifier" valeur={lieux.filter((l) => l.verificationStatut === 'A_REVERIFIER').length} icon={Activity} indice="plus de 12 mois sans vérification" />
          <CarteResume libelle="Garde le week-end" valeur={nbGarde} icon={MoonStar} />
          <CarteResume libelle="Sans position GPS" valeur={nbSansPosition} icon={MapPin} indice="absents de la carte" />
        </GrilleCartes>

        <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:overflow-x-auto">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher : nom, code, ville…"
            aria-label="Rechercher"
            className="h-9 w-full min-w-0 sm:w-auto sm:min-w-40 sm:flex-1"
          />
          <select value={fStatut} onChange={(e) => setFStatut(e.target.value)} aria-label="Statut" className={`${CLASSE_FILTRE} shrink-0`}>
            <option value="">Tous les statuts</option>
            {statutsPresents.map((st) => (
              <option key={st} value={st}>
                {LIBELLE_STATUT_LIEU[st] ?? st}
              </option>
            ))}
          </select>
          {estEtab && (
            <select value={fCategorie} onChange={(e) => setFCategorie(e.target.value)} aria-label="Catégorie" className={`${CLASSE_FILTRE} shrink-0`}>
              <option value="">Toutes les catégories</option>
              {OPTIONS_CATEGORIE_ETABLISSEMENT.map((c) => (
                <option key={c.valeur} value={c.valeur}>
                  {c.libelle}
                </option>
              ))}
            </select>
          )}
          <select value={fVerif} onChange={(e) => setFVerif(e.target.value)} aria-label="Vérification" className={`${CLASSE_FILTRE} shrink-0`}>
            <option value="">Toutes les vérifications</option>
            <option value="A_REVERIFIER">À revérifier</option>
            <option value="JAMAIS">Jamais vérifié</option>
          </select>
          {filtresActifs && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                setQ('');
                setFStatut('');
                setFCategorie('');
                setFVerif('');
              }}
            >
              Réinitialiser
            </Button>
          )}
          {nbArchives > 0 && (
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
              <input type="checkbox" checked={voirArchives} onChange={(e) => setVoirArchives(e.target.checked)} />
              Archivés ({nbArchives})
            </label>
          )}
          <FormulaireModal
            titre={estEtab ? 'Nouvel établissement' : 'Nouvelle pharmacie'}
            description="Les champs marqués d’un astérisque sont obligatoires. Sans latitude / longitude, la position est calculée automatiquement à partir de l’adresse."
            declencheurLabel={estEtab ? 'Nouvel établissement' : 'Nouvelle pharmacie'}
            libelleSoumettre="Créer"
            onSoumettre={async (fd) => {
              const base = {
                nom: String(fd.get('nom') ?? ''),
                code: String(fd.get('code') ?? ''),
                ville: String(fd.get('ville') ?? '') || undefined,
                commune: String(fd.get('commune') ?? '') || undefined,
                adresseComplete: String(fd.get('adresseComplete') ?? '') || undefined,
                telephone: String(fd.get('telephone') ?? '') || undefined,
                latitude: num(fd.get('latitude')),
                longitude: num(fd.get('longitude')),
                gardeWeekend: fd.get('gardeWeekend') === 'on',
              };
              const r = estEtab
                ? await creerEtablissement({
                    ...base,
                    typeEtablissement: String(fd.get('typeEtablissement') ?? ''),
                    categorieEtablissement: String(fd.get('categorieEtablissement') ?? '') || undefined,
                  })
                : await creerPharmacie(base);
              return r.ok ? { ok: true as const, message: r.message } : { ok: false as const, error: r.error };
            }}
            onSucces={() => router.refresh()}
          >
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Identité</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChampTexte name="nom" label="Nom" required />
                <ChampTexte name="code" label="Code" required placeholder="Unique" />
              </div>
              {estEtab && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChampSelect
                    name="typeEtablissement"
                    label="Type"
                    required
                    placeholder="Choisir…"
                    options={TYPES_ETABLISSEMENT.map((t) => ({ valeur: t, libelle: LIBELLE_TYPE_ETABLISSEMENT[t] }))}
                  />
                  <ChampSelect
                    name="categorieEtablissement"
                    label="Catégorie"
                    aide="Niveau hiérarchique : une formule couvre sa catégorie et les catégories inférieures."
                    defaultValue="CENTRE_MEDICAL"
                    options={OPTIONS_CATEGORIE_ETABLISSEMENT}
                  />
                </div>
              )}
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Adresse</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChampTexte name="ville" label="Ville" defaultValue="Abidjan" />
                <ChampTexte name="commune" label="Commune" />
              </div>
              <ChampTexte name="adresseComplete" label="Adresse complète" placeholder="Rue / boulevard, repère…" />
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Contact et localisation</p>
              <ChampTexte name="telephone" label="Téléphone" />
              <div className="grid gap-3 sm:grid-cols-2">
                <ChampTexte name="latitude" label="Latitude" inputMode="decimal" placeholder="auto si vide" />
                <ChampTexte name="longitude" label="Longitude" inputMode="decimal" placeholder="auto si vide" />
              </div>
              <ChampCheckbox name="gardeWeekend" label="Garde le week-end" />
            </div>
          </FormulaireModal>
        </div>
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
                        {libelleTypeEtablissement(l.typeEtablissement)}
                        <span className="block text-xs">{libelleCategorieEtablissement(l.categorieEtablissement)}</span>
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
                        {LIBELLE_STATUT_LIEU[l.statut] ?? l.statut}
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
                          libelles={LIBELLE_VERIFICATION}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          jamais vérifié
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {l.latitude != null && l.longitude != null ? (
                        `${l.latitude.toFixed(3)}, ${l.longitude.toFixed(3)}`
                      ) : (
                        <span title="Le géocodage automatique de l’adresse a échoué (ou l’adresse manque) : cet établissement n’apparaît pas sur la carte. Saisissez la latitude et la longitude à la main (Modifier).">
                          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
                            Position non résolue
                          </Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="flex justify-end gap-2">
                        <Button asChild type="button" size="xs" variant="ghost">
                          <Link
                            href={`/dashboard-assureur/informatique/${
                              estEtab ? 'etablissements' : 'pharmacies'
                            }/${l.id}`}
                          >
                            Détails
                          </Link>
                        </Button>
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
                          description="Contact et adresse sont libres. Le nom et le code sont tracés dans l’audit (ancienne et nouvelle valeur). Un changement d’adresse relance le géocodage de la position."
                          declencheur={
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              disabled={!!verdicts[l.id]?.modifier && !verdicts[l.id].modifier.possible}
                              title={verdicts[l.id]?.modifier && !verdicts[l.id].modifier.possible ? (verdicts[l.id].modifier.raison ?? undefined) : undefined}
                            >
                              Modifier
                            </Button>
                          }
                          libelleSoumettre="Enregistrer"
                          onSoumettre={async (fd) => {
                            const input = {
                              nom: String(fd.get('nom') ?? '') || undefined,
                              code: String(fd.get('code') ?? '') || undefined,
                              ville: String(fd.get('ville') ?? '') || undefined,
                              commune: String(fd.get('commune') ?? '') || undefined,
                              quartier: String(fd.get('quartier') ?? '') || undefined,
                              adresseComplete:
                                String(fd.get('adresseComplete') ?? '') || undefined,
                              telephone:
                                String(fd.get('telephone') ?? '') || undefined,
                              email: String(fd.get('email') ?? '') || undefined,
                              gardeWeekend: fd.get('gardeWeekend') === 'on',
                            };
                            const r = estEtab
                              ? await modifierEtablissement(l.id, {
                                  ...input,
                                  typeEtablissement:
                                    String(fd.get('typeEtablissement') ?? '') ||
                                    undefined,
                                  categorieEtablissement: String(fd.get('categorieEtablissement') ?? '') || undefined,
                                })
                              : await modifierPharmacie(l.id, input);
                            return r.ok
                              ? { ok: true, message: r.message }
                              : { ok: false, error: r.error };
                          }}
                        >
                          <ChampTexte name="nom" label="Nom" required defaultValue={l.nom} />
                          <ChampTexte name="code" label="Code" required defaultValue={l.code} />
                          {estEtab && (
                            <ChampSelect
                              name="categorieEtablissement"
                              label="Catégorie"
                              aide="Niveau hiérarchique : une formule couvre sa catégorie et les catégories inférieures."
                              defaultValue={l.categorieEtablissement}
                              options={OPTIONS_CATEGORIE_ETABLISSEMENT}
                            />
                          )}
                          {estEtab && (
                            <ChampSelect
                              name="typeEtablissement"
                              label="Type"
                              defaultValue={l.typeEtablissement}
                              options={TYPES_ETABLISSEMENT.map((t) => ({
                                valeur: t,
                                libelle: LIBELLE_TYPE_ETABLISSEMENT[t],
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
                          <ChampTexte name="quartier" label="Quartier" defaultValue={l.quartier ?? undefined} />
                          <ChampTexte
                            name="adresseComplete"
                            label="Adresse complète"
                            defaultValue={l.adresseComplete ?? undefined}
                          />
                          <ChampTexte name="telephone" label="Téléphone" defaultValue={l.telephone ?? undefined} />
                          <ChampTexte name="email" label="E-mail" type="email" defaultValue={l.email ?? undefined} />
                          <ChampCheckbox
                            name="gardeWeekend"
                            label="Garde le week-end"
                            defaultChecked={l.gardeWeekend}
                          />
                        </FormulaireModal>
                        {!estArchive(l) && peutReactiver && (
                          <ToutReactiver
                            cible={estEtab ? 'etablissement' : 'pharmacie'}
                            id={l.id}
                            nom={l.nom}
                            comptes={desactives[l.id] ?? []}
                          />
                        )}
                        {estArchive(l) ? (
                          <ConfirmationAction
                            action="desarchiver"
                            element={`${estEtab ? "l’établissement" : 'la pharmacie'} « ${l.nom} »`}
                            consequence="Il redevient visible dans l’annuaire public et accepte de nouveau dossiers et facturation. Les comptes rattachés ne sont PAS réactivés automatiquement."
                            verifier={() => verifierAction(estEtab ? 'etablissement' : 'pharmacie', l.id, 'desarchiver')}
                            onConfirmer={() => changerArchivageLieu(kind, l.id, 'desarchiver')}
                            onSucces={() => router.refresh()}
                          />
                        ) : (
                          <ConfirmationAction
                            action="archiver"
                            element={`${estEtab ? "l’établissement" : 'la pharmacie'} « ${l.nom} »`}
                            consequence="Il disparaît de l’annuaire public, n’accepte plus de nouveau dossier ni de facturation, et les comptes qui lui sont rattachés ne peuvent plus agir. L’historique et les factures passées restent lisibles."
                            verifier={() => verifierAction(estEtab ? 'etablissement' : 'pharmacie', l.id, 'archiver')}
                            onConfirmer={() => changerArchivageLieu(kind, l.id, 'archiver')}
                            onSucces={() => router.refresh()}
                          />
                        )}
                        <ConfirmationAction
                          action="supprimer"
                          element={`${estEtab ? "l’établissement" : 'la pharmacie'} « ${l.nom} »`}
                          consequence="Il est retiré du réseau (suppression logique, tracée). Possible uniquement s’il n’a aucun lien."
                          verifier={() => verifierAction(estEtab ? 'etablissement' : 'pharmacie', l.id, 'supprimer')}
                          onConfirmer={() => (estEtab ? supprimerEtablissement(l.id) : supprimerPharmacie(l.id))}
                          onSucces={() => router.refresh()}
                        />
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
