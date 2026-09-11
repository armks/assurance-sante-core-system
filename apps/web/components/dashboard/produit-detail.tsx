'use client';

import { Info, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ajouterGarantie,
  creerNouvelleVersion,
  publierProduit,
  renommerProduit,
  supprimerGarantie,
} from '@/app/dashboard-assureur/informatique/produits/actions';
import {
  ChampNombre,
  ChampSelect,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Garantie {
  id: string;
  categorieActe: string;
  tauxCouverture: string | number | null;
  plafondParActe: string | number | null;
  plafondAnnuel: string | number | null;
  franchise: string | number | null;
  ticketModerateur: string | number | null;
  delaiCarenceJours: number | null;
  reseauSoins: string;
  exclusions: string[];
}

export interface ProduitAvecGaranties {
  id: string;
  nom: string;
  version: number;
  statut: 'BROUILLON' | 'PUBLIE' | 'ARCHIVE';
  datePublication: string | null;
  createdAt: string;
  garanties: Garantie[];
}

const CATEGORIES_ACTE = [
  'CONSULTATION',
  'HOSPITALISATION',
  'PHARMACIE',
  'ANALYSES_LABORATOIRE',
  'IMAGERIE',
  'OPTIQUE',
  'DENTAIRE',
  'MATERNITE',
  'SOINS_INFIRMIERS',
  'TRANSPORT_SANITAIRE',
  'AUTRE',
];

const LIBELLE_RESEAU: Record<string, string> = {
  TOUT_RESEAU: 'Tout réseau',
  CONVENTIONNE_SEUL: 'Conventionné seul',
};

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  PUBLIE: 'Publié',
  ARCHIVE: 'Archivé',
};

function montant(v: string | number | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${Number(v).toLocaleString('fr-FR')} F`;
}
function pourcent(v: string | number | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${Number(v)} %`;
}

export function ProduitDetail({
  produit,
  peutPublier = true,
}: {
  produit: ProduitAvecGaranties;
  /** `false` pour un rôle adjoint : masque « Publier le produit ». */
  peutPublier?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const brouillon = produit.statut === 'BROUILLON';
  const versionnable =
    produit.statut === 'PUBLIE' || produit.statut === 'ARCHIVE';
  const sansGarantie = produit.garanties.length === 0;

  const colonnes: ColonneTable<Garantie>[] = [
    { cle: 'categorieActe', entete: 'Catégorie', triable: true },
    {
      cle: 'tauxCouverture',
      entete: 'Taux',
      aligneDroite: true,
      rendu: (g) => pourcent(g.tauxCouverture),
    },
    {
      cle: 'plafondParActe',
      entete: 'Plafond / acte',
      aligneDroite: true,
      rendu: (g) => montant(g.plafondParActe),
    },
    {
      cle: 'plafondAnnuel',
      entete: 'Plafond / an',
      aligneDroite: true,
      rendu: (g) => montant(g.plafondAnnuel),
    },
    {
      cle: 'franchise',
      entete: 'Franchise',
      aligneDroite: true,
      rendu: (g) => montant(g.franchise),
    },
    {
      cle: 'ticketModerateur',
      entete: 'Ticket mod.',
      aligneDroite: true,
      rendu: (g) => pourcent(g.ticketModerateur),
    },
    {
      cle: 'delaiCarenceJours',
      entete: 'Carence',
      aligneDroite: true,
      rendu: (g) =>
        g.delaiCarenceJours != null ? `${g.delaiCarenceJours} j` : '—',
    },
    {
      cle: 'reseauSoins',
      entete: 'Réseau',
      rendu: (g) => LIBELLE_RESEAU[g.reseauSoins] ?? g.reseauSoins,
    },
    {
      cle: 'exclusions',
      entete: 'Exclusions',
      rendu: (g) =>
        g.exclusions.length > 0 ? (
          <span title={g.exclusions.join('\n')}>
            {g.exclusions.length} exclusion{g.exclusions.length > 1 ? 's' : ''}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  const publier = () =>
    start(async () => {
      setErreur(null);
      const r = await publierProduit(produit.id);
      if (r.ok) router.refresh();
      else setErreur(r.error);
    });

  const nouvelleVersion = () =>
    start(async () => {
      setErreur(null);
      const r = await creerNouvelleVersion(produit.id);
      if (r.ok)
        router.push(`/dashboard-assureur/informatique/produits/${r.id}`);
      else setErreur(r.error);
    });

  return (
    <div className="space-y-6">
      {/* --- Bandeau lecture seule (cohérent avec le 409 de l'API) --- */}
      {!brouillon && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm text-sky-800 dark:text-sky-300">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <p>
            Produit {LIBELLE_STATUT[produit.statut].toLowerCase()} — le nom et
            les garanties sont figés (lecture seule). Toute évolution passe par
            une nouvelle version.
          </p>
        </div>
      )}

      {erreur && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {erreur}
        </div>
      )}

      {/* --- Informations produit --- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Informations</CardTitle>
          {brouillon && (
            <FormulaireModal
              titre="Renommer le produit"
              mode="center"
              declencheur={
                <Button size="sm" variant="outline">
                  Renommer
                </Button>
              }
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) =>
                renommerProduit(produit.id, {
                  nom: String(fd.get('nom') ?? ''),
                })
              }
              onSucces={() => router.refresh()}
            >
              <ChampTexte
                name="nom"
                label="Nom du produit"
                required
                defaultValue={produit.nom}
              />
            </FormulaireModal>
          )}
        </CardHeader>
        <CardContent className="grid gap-1.5 text-sm sm:grid-cols-2">
          <Ligne label="Statut">
            <StatutBadge
              statut={produit.statut}
              libelle={LIBELLE_STATUT[produit.statut]}
            />
          </Ligne>
          <Ligne label="Version">v{produit.version}</Ligne>
          <Ligne label="Garanties">{produit.garanties.length}</Ligne>
          <Ligne label="Créé le">
            {new Date(produit.createdAt).toLocaleDateString('fr-FR')}
          </Ligne>
          {produit.datePublication && (
            <Ligne label="Publié le">
              {new Date(produit.datePublication).toLocaleDateString('fr-FR')}
            </Ligne>
          )}
        </CardContent>
      </Card>

      {/* --- Garanties --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Garanties</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={produit.garanties}
            cleLigne={(g) => g.id}
            parPage={0}
            colonnes={colonnes}
            actions={
              brouillon ? (
                <FormulaireModal
                  titre="Ajouter une garantie"
                  description="Une ligne de couverture par catégorie d’acte."
                  declencheurLabel="Ajouter une garantie"
                  libelleSoumettre="Ajouter la garantie"
                  onSoumettre={async (fd) => {
                    const num = (k: string) => {
                      const v = fd.get(k);
                      return v === null || v === '' ? undefined : Number(v);
                    };
                    return ajouterGarantie(produit.id, {
                      categorieActe: String(fd.get('categorieActe') ?? ''),
                      tauxCouverture: num('tauxCouverture'),
                      plafondParActe: num('plafondParActe'),
                      plafondAnnuel: num('plafondAnnuel'),
                      franchise: num('franchise'),
                      ticketModerateur: num('ticketModerateur'),
                      delaiCarenceJours: num('delaiCarenceJours'),
                      reseauSoins: String(fd.get('reseauSoins') ?? 'TOUT_RESEAU'),
                      exclusions: String(fd.get('exclusions') ?? '')
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    });
                  }}
                  onSucces={() => router.refresh()}
                >
                  <ChampSelect
                    name="categorieActe"
                    label="Catégorie d’acte"
                    required
                    placeholder="Choisir une catégorie…"
                    options={CATEGORIES_ACTE.map((c) => ({
                      valeur: c,
                      libelle: c.replace(/_/g, ' '),
                    }))}
                  />
                  <ChampNombre
                    name="tauxCouverture"
                    label="Taux de couverture (%)"
                    min={0}
                    max={100}
                    step="0.01"
                  />
                  <ChampNombre
                    name="plafondParActe"
                    label="Plafond par acte (FCFA)"
                    min={0}
                  />
                  <ChampNombre
                    name="plafondAnnuel"
                    label="Plafond annuel (FCFA)"
                    min={0}
                  />
                  <ChampNombre
                    name="franchise"
                    label="Franchise (FCFA)"
                    min={0}
                  />
                  <ChampNombre
                    name="ticketModerateur"
                    label="Ticket modérateur (%)"
                    min={0}
                    max={100}
                    step="0.01"
                  />
                  <ChampNombre
                    name="delaiCarenceJours"
                    label="Délai de carence (jours)"
                    min={0}
                    step={1}
                  />
                  <ChampSelect
                    name="reseauSoins"
                    label="Réseau de soins"
                    defaultValue="TOUT_RESEAU"
                    options={[
                      { valeur: 'TOUT_RESEAU', libelle: 'Tout réseau' },
                      {
                        valeur: 'CONVENTIONNE_SEUL',
                        libelle: 'Conventionné seul',
                      },
                    ]}
                  />
                  <ChampZone
                    name="exclusions"
                    label="Exclusions"
                    aide="Une exclusion par ligne."
                    placeholder={'Actes esthétiques\nCures thermales'}
                  />
                </FormulaireModal>
              ) : undefined
            }
            actionLigne={
              brouillon
                ? (g) => (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setErreur(null);
                          const r = await supprimerGarantie(produit.id, g.id);
                          if (r.ok) router.refresh();
                          else setErreur(r.error);
                        })
                      }
                    >
                      Retirer
                    </Button>
                  )
                : undefined
            }
            vide="Aucune garantie. Ajoutez-en au moins une avant de publier."
          />
        </CardContent>
      </Card>

      {/* --- Actions de cycle de vie --- */}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        {brouillon && peutPublier && (
          <>
            <Button disabled={pending || sansGarantie} onClick={publier}>
              Publier le produit
            </Button>
            {sansGarantie && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="size-3.5" />
                Ajoutez au moins une garantie pour pouvoir publier.
              </p>
            )}
          </>
        )}
        {brouillon && !peutPublier && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" />
            La publication d’un produit est réservée au titulaire Assurance
            Informatique.
          </p>
        )}
        {versionnable && (
          <Button variant="outline" disabled={pending} onClick={nouvelleVersion}>
            Créer une nouvelle version
          </Button>
        )}
      </div>
    </div>
  );
}

function Ligne({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 sm:border-b sm:last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
