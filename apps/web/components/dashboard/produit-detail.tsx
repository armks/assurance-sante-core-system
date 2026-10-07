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
  modifierProduit,
  supprimerGarantie,
  type GarantieInput,
} from '@/app/dashboard-assureur/informatique/produits/actions';
import {
  ChampCheckbox,
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
import { useCategoriesActe } from '@/components/categories-acte';
import {
  AIDE_PERIODE_CUMUL,
  AIDE_PLAFOND_FAMILLE,
  AIDE_PLAFOND_PERSONNE,
  LIBELLE_PERIODE_CUMUL,
  OPTIONS_PERIODE_CUMUL,
  type PeriodeCumulPlafond,
} from '@/lib/plafonds';

interface Garantie {
  id: string;
  categorieActe: string;
  tauxCouverture: string | number | null;
  plafondParActe: string | number | null;
  plafondAnnuelPersonne: string | number | null;
  plafondAnnuelFamille: string | number | null;
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
  /** Période de cumul des plafonds annuels (prisma/sql/069). */
  periodeCumulPlafond: PeriodeCumulPlafond;
  garanties: Garantie[];
  /** Catégories actives du référentiel sans garantie (calculé par l'API) :
   * à confirmer « non couvertes » avant publication. */
  categoriesSansGarantie: string[];
  /** Catégories confirmées non couvertes à la publication. */
  categoriesNonCouvertes: string[];
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
  const { options: optionsCategories } = useCategoriesActe();
  return (
    <>
      <ChampSelect
        name="categorieActe"
        label="Catégorie d’acte"
        required
        placeholder="Choisir une catégorie…"
        defaultValue={defaut?.categorieActe}
        options={optionsCategories()}
      />
      <ChampNombre
        name="tauxCouverture"
        label="Taux de couverture (%)"
        min={0}
        max={100}
        step="0.01"
        required
        aide="Obligatoire : une catégorie sans garantie n’est pas couverte (le patient paie tout)."
        defaultValue={defaut?.tauxCouverture ?? undefined}
      />
      <ChampNombre
        name="plafondParActe"
        label="Plafond par acte (FCFA)"
        min={0}
        defaultValue={defaut?.plafondParActe ?? undefined}
      />
      <ChampNombre
        name="plafondAnnuelPersonne"
        label="Plafond annuel par personne (FCFA)"
        min={0}
        aide={AIDE_PLAFOND_PERSONNE}
        defaultValue={defaut?.plafondAnnuelPersonne ?? undefined}
      />
      <ChampNombre
        name="plafondAnnuelFamille"
        label="Plafond annuel par famille (FCFA)"
        min={0}
        aide={AIDE_PLAFOND_FAMILLE}
        defaultValue={defaut?.plafondAnnuelFamille ?? undefined}
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
  // plafonds annuels : vide = AUCUN plafond (null efface la valeur en modification)
  const plafond = (k: string) => {
    const v = fd.get(k);
    return v === null || v === '' ? null : Number(v);
  };
  return {
    categorieActe: String(fd.get('categorieActe') ?? ''),
    tauxCouverture: num('tauxCouverture'),
    plafondParActe: num('plafondParActe'),
    plafondAnnuelPersonne: plafond('plafondAnnuelPersonne'),
    plafondAnnuelFamille: plafond('plafondAnnuelFamille'),
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
  const { libelle: libelleCategorieActe } = useCategoriesActe();
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
      cle: 'plafondAnnuelPersonne',
      entete: 'Plafond / an / personne',
      aligneDroite: true,
      rendu: (g) => montant(g.plafondAnnuelPersonne),
    },
    {
      cle: 'plafondAnnuelFamille',
      entete: 'Plafond / an / famille',
      aligneDroite: true,
      rendu: (g) => montant(g.plafondAnnuelFamille),
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
              titre="Modifier le produit"
              mode="center"
              declencheur={
                <Button size="sm" variant="outline">
                  Modifier
                </Button>
              }
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) =>
                modifierProduit(produit.id, {
                  nom: String(fd.get('nom') ?? ''),
                  periodeCumulPlafond: String(fd.get('periodeCumulPlafond') ?? 'ANNEE_POLICE'),
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
              <ChampSelect
                name="periodeCumulPlafond"
                label="Période des plafonds annuels"
                required
                aide={AIDE_PERIODE_CUMUL}
                defaultValue={produit.periodeCumulPlafond}
                options={OPTIONS_PERIODE_CUMUL}
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
          <Ligne label="Période des plafonds annuels">
            {LIBELLE_PERIODE_CUMUL[produit.periodeCumulPlafond] ?? produit.periodeCumulPlafond}
          </Ligne>
          <Ligne label="Garanties">{produit.garanties.length}</Ligne>
          {!brouillon && (
            <Ligne label="Catégories non couvertes">
              {produit.categoriesNonCouvertes.length > 0
                ? produit.categoriesNonCouvertes.map(libelleCategorieActe).join(', ')
                : 'Aucune'}
            </Ligne>
          )}
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
            <FormulaireModal
              titre="Publier le produit"
              mode="center"
              description={
                produit.categoriesSansGarantie.length > 0
                  ? 'Ces catégories d’acte n’ont pas de garantie dans ce produit. Une fois publié, leurs actes ne seront PAS pris en charge : le patient en paiera l’intégralité. Cochez chacune pour confirmer, ou fermez et ajoutez la garantie correspondante.'
                  : 'Toutes les catégories d’acte ont une garantie. La version publiée devient immuable.'
              }
              declencheur={
                <Button disabled={pending || sansGarantie}>Publier le produit</Button>
              }
              libelleSoumettre="Publier"
              onSoumettre={async (fd) =>
                publierProduit(
                  produit.id,
                  fd.getAll('categorieNonCouverte').map(String),
                )
              }
              onSucces={() => router.refresh()}
            >
              {produit.categoriesSansGarantie.map((code) => (
                <ChampCheckbox
                  key={code}
                  name="categorieNonCouverte"
                  value={code}
                  required
                  label={`${libelleCategorieActe(code)} — non couverte`}
                />
              ))}
            </FormulaireModal>
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
