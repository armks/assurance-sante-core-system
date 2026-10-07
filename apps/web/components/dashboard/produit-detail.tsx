'use client';

import { Info, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ajouterGarantie,
  archiverProduit,
  creerNouvelleVersion,
  modifierGarantie,
  publierProduit,
  renommerProduit,
  supprimerGarantie,
  type GarantieInput,
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
import {
  CATEGORIES_GARANTIE,
  libelleCategorieActe,
  optionsCategorieActe,
} from '@/lib/referentiel';

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

const LIBELLE_RESEAU: Record<string, string> = {
  TOUT_RESEAU: 'Tout réseau',
  CONVENTIONNE_SEUL: 'Conventionné seul',
};

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  PUBLIE: 'Publié',
  ARCHIVE: 'Archivé',
};

/** Champs communs au formulaire d'ajout/modification d'une garantie. */
function ChampsGarantie({ defaut }: { defaut?: Garantie }) {
  return (
    <>
      <ChampSelect
        name="categorieActe"
        label="Catégorie d’acte"
        required
        placeholder="Choisir une catégorie…"
        defaultValue={defaut?.categorieActe}
        options={optionsCategorieActe(CATEGORIES_GARANTIE)}
      />
      <ChampNombre
        name="tauxCouverture"
        label="Taux de couverture (%)"
        min={0}
        max={100}
        step="0.01"
        defaultValue={defaut?.tauxCouverture ?? undefined}
      />
      <ChampNombre
        name="plafondParActe"
        label="Plafond par acte (FCFA)"
        min={0}
        defaultValue={defaut?.plafondParActe ?? undefined}
      />
      <ChampNombre
        name="plafondAnnuel"
        label="Plafond annuel (FCFA)"
        min={0}
        defaultValue={defaut?.plafondAnnuel ?? undefined}
      />
      <ChampNombre
        name="franchise"
        label="Franchise (FCFA)"
        min={0}
        defaultValue={defaut?.franchise ?? undefined}
      />
      <ChampNombre
        name="ticketModerateur"
        label="Ticket modérateur (%)"
        min={0}
        max={100}
        step="0.01"
        defaultValue={defaut?.ticketModerateur ?? undefined}
      />
      <ChampNombre
        name="delaiCarenceJours"
        label="Délai de carence (jours)"
        min={0}
        step={1}
        defaultValue={defaut?.delaiCarenceJours ?? undefined}
      />
      <ChampSelect
        name="reseauSoins"
        label="Réseau de soins"
        defaultValue={defaut?.reseauSoins ?? 'TOUT_RESEAU'}
        options={[
          { valeur: 'TOUT_RESEAU', libelle: 'Tout réseau' },
          { valeur: 'CONVENTIONNE_SEUL', libelle: 'Conventionné seul' },
        ]}
      />
      <ChampZone
        name="exclusions"
        label="Exclusions"
        aide="Une exclusion par ligne."
        placeholder={'Actes esthétiques\nCures thermales'}
        defaultValue={defaut?.exclusions?.join('\n')}
      />
    </>
  );
}

function lireGarantieFormData(fd: FormData): GarantieInput {
  const num = (k: string) => {
    const v = fd.get(k);
    return v === null || v === '' ? undefined : Number(v);
  };
  return {
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
  };
}

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
  peutGererPlan = true,
}: {
  produit: ProduitAvecGaranties;
  /** `false` si le rôle n'est ni ASSUREUR_DIRECTION ni ASSUREUR_INFORMATIQUE
   * (seuls rôles habilités côté API, `ROLES_GESTION_PLAN`) : masque toutes les
   * actions d'écriture (renommer, publier, archiver, nouvelle version,
   * garanties). */
  peutGererPlan?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const brouillon = produit.statut === 'BROUILLON';
  const archive = produit.statut === 'ARCHIVE';
  const versionnable =
    produit.statut === 'PUBLIE' || produit.statut === 'ARCHIVE';
  const sansGarantie = produit.garanties.length === 0;

  const colonnes: ColonneTable<Garantie>[] = [
    {
      cle: 'categorieActe',
      entete: 'Catégorie',
      triable: true,
      valeur: (g) => libelleCategorieActe(g.categorieActe),
      rendu: (g) => libelleCategorieActe(g.categorieActe),
    },
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

  const archiver = () =>
    start(async () => {
      setErreur(null);
      const r = await archiverProduit(produit.id);
      if (r.ok) router.refresh();
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
          {brouillon && peutGererPlan && (
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
              brouillon && peutGererPlan ? (
                <FormulaireModal
                  titre="Ajouter une garantie"
                  description="Une ligne de couverture par catégorie d’acte."
                  declencheurLabel="Ajouter une garantie"
                  libelleSoumettre="Ajouter la garantie"
                  onSoumettre={async (fd) =>
                    ajouterGarantie(produit.id, lireGarantieFormData(fd))
                  }
                  onSucces={() => router.refresh()}
                >
                  <ChampsGarantie />
                </FormulaireModal>
              ) : undefined
            }
            actionLigne={
              brouillon && peutGererPlan
                ? (g) => (
                    <span className="flex justify-end gap-2">
                      <FormulaireModal
                        titre="Modifier la garantie"
                        description="Produit encore en brouillon — modification directe."
                        declencheur={
                          <Button type="button" size="xs" variant="ghost">
                            Modifier
                          </Button>
                        }
                        libelleSoumettre="Enregistrer"
                        onSoumettre={async (fd) =>
                          modifierGarantie(
                            produit.id,
                            g.id,
                            lireGarantieFormData(fd),
                          )
                        }
                        onSucces={() => router.refresh()}
                      >
                        <ChampsGarantie defaut={g} />
                      </FormulaireModal>
                      <Button
                        type="button"
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
                    </span>
                  )
                : undefined
            }
            vide="Aucune garantie. Ajoutez-en au moins une avant de publier."
          />
        </CardContent>
      </Card>

      {/* --- Actions de cycle de vie --- */}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        {brouillon && peutGererPlan && (
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
        {brouillon && !peutGererPlan && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" />
            La gestion des produits est réservée à la Direction et à
            l’Assurance Informatique.
          </p>
        )}
        {versionnable && peutGererPlan && (
          <Button variant="outline" disabled={pending} onClick={nouvelleVersion}>
            Créer une nouvelle version
          </Button>
        )}
        {!archive && peutGererPlan && (
          <Button variant="outline" disabled={pending} onClick={archiver}>
            Archiver
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
