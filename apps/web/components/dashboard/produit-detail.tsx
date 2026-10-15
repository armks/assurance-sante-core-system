'use client';

import { changerFormuleEnMasse } from '@/app/dashboard-assureur/informatique/polices/actions';
import { OPTIONS_CATEGORIE_ETABLISSEMENT, libelleCategorieEtablissement } from '@/lib/reseau';
import { Info, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ajouterGarantie,
  ajusterTarifsFormule,
  etendreProduitPublie,
  modifierNiveauAcces,
  archiverProduit,
  creerNouvelleVersion,
  desarchiverProduit,
  supprimerProduit,
  modifierGarantie,
  publierProduit,
  modifierProduit,
  supprimerGarantie,
  type GarantieInput,
} from '@/app/dashboard-assureur/informatique/produits/actions';
import { verifierAction } from '@/app/dependances-actions';
import {
  ConfirmationAction,
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
  AIDE_DELAI_DECLARATION,
  AIDE_PERIODE_CUMUL,
  DELAI_DECLARATION_DEFAUT_JOURS,
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
  /** Délai de déclaration après la fin de la police, en jours (prisma/sql/071). */
  delaiDeclarationJours: number;
  niveauAccesEtablissement?: string;
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
function ChampsGarantie({ defaut, exclues = [], avecMotif = false }: { defaut?: Garantie; exclues?: string[]; avecMotif?: boolean }) {
  const { options: optionsCategories } = useCategoriesActe();
  return (
    <>
      {avecMotif && (
        <ChampTexte
          name="motif"
          label="Motif de la modification"
          required
          minLength={5}
          maxLength={500}
          aide="Formule publiée : la modification s’applique aux soins à venir de toutes ses polices et est tracée avec ce motif (valeurs avant / après)."
        />
      )}
      <ChampSelect
        name="categorieActe"
        label="Catégorie d’acte"
        required
        placeholder="Choisir une catégorie…"
        defaultValue={defaut?.categorieActe}
        options={optionsCategories().filter((o) => !exclues.includes(o.valeur))}
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
    motif: String(fd.get('motif') ?? '').trim() || undefined,
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
  // Après une évolution des garanties / de l'accès : on propose d'ajuster aussi le coût de la formule.
  const [rappelTarifs, setRappelTarifs] = useState(false);

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

  const modaleAjusterTarifs = (declencheur: React.ReactNode) => (
          <FormulaireModal
            titre="Ajuster le coût de la formule"
            mode="center"
            description="Hausse (+) ou baisse (−) en pourcentage de toutes les grilles tarifaires de cette formule. Ne touche que les cotisations calculées ensuite ; celles déjà émises ne changent pas."
            declencheur={declencheur}
            libelleSoumettre="Appliquer l’ajustement"
            onSoumettre={async (fd) =>
              ajusterTarifsFormule(produit.id, {
                pourcentage: Number(fd.get('pourcentage')),
                motif: String(fd.get('motif') ?? '').trim(),
              })
            }
            onSucces={() => {
 router.refresh();
 setRappelTarifs(false);
 }}
          >
            <ChampNombre
              name="pourcentage"
              label="Variation des tarifs (%)"
              required
              min={-90}
              max={500}
              step="0.01"
              aide="Exemples : 10 = hausse de 10 % ; -15 = baisse de 15 %."
            />
            <ChampTexte name="motif" label="Motif" required minLength={5} maxLength={500} />
          </FormulaireModal>
  );

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
      {rappelTarifs && peutGererPlan && !archive && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200">
          <Info className="size-4 shrink-0" />
          <p className="flex-1">
            Les garanties de cette formule ont évolué : pensez à ajuster aussi son <b>coût</b> (hausse ou baisse des tarifs) pour rester
            cohérent avec la couverture.
          </p>
          {modaleAjusterTarifs(<Button size="sm">Ajuster le coût</Button>)}
          <Button size="sm" variant="ghost" onClick={() => setRappelTarifs(false)}>
            Plus tard
          </Button>
        </div>
      )}
      {/* --- Bandeau lecture seule (cohérent avec le 409 de l'API) --- */}
      {!brouillon && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm text-sky-800 dark:text-sky-300">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <p>
            Produit {LIBELLE_STATUT[produit.statut].toLowerCase()} — le nom et
            les garanties peuvent être modifiées (avec un motif, tracées) ou étendues
            par de nouvelles garanties ; le nom et la catégorie d’une garantie ne changent pas.
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
                  delaiDeclarationJours: Number(fd.get('delaiDeclarationJours') ?? DELAI_DECLARATION_DEFAUT_JOURS),
                  niveauAccesEtablissement: String(fd.get('niveauAccesEtablissement') ?? '') || undefined,
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
              <ChampSelect
                name="niveauAccesEtablissement"
                label="Niveau d’accès aux établissements"
                aide="Catégorie d’établissement la plus haute couverte ; les catégories inférieures le sont aussi (une formule « Clinique » couvre aussi hôpital public et centre médical, pas la polyclinique)."
                defaultValue={produit.niveauAccesEtablissement ?? 'POLYCLINIQUE'}
                options={OPTIONS_CATEGORIE_ETABLISSEMENT}
              />
              <ChampNombre
                name="delaiDeclarationJours"
                label="Délai de déclaration après la fin du contrat (jours)"
                required
                min={0}
                max={3650}
                step={1}
                aide={AIDE_DELAI_DECLARATION}
                defaultValue={produit.delaiDeclarationJours ?? DELAI_DECLARATION_DEFAUT_JOURS}
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
          <Ligne label="Délai de déclaration après la fin du contrat">
            {produit.delaiDeclarationJours ?? DELAI_DECLARATION_DEFAUT_JOURS} jours
          </Ligne>
          <Ligne label="Accès aux établissements">
            jusqu’à « {libelleCategorieEtablissement(produit.niveauAccesEtablissement ?? 'POLYCLINIQUE')} » (et en dessous)
            {produit.statut === 'PUBLIE' && peutGererPlan && (
              <FormulaireModal
                titre="Modifier l’accès aux établissements"
                mode="center"
                description="Formule publiée : le nouveau niveau s’applique aux prochaines demandes de soins de toutes ses polices (les dossiers déjà ouverts ne changent pas). Modification tracée avec son motif."
                declencheur={
                  <Button size="xs" variant="outline" className="ml-2">
                    Modifier
                  </Button>
                }
                libelleSoumettre="Enregistrer"
                onSoumettre={async (fd) =>
                  modifierNiveauAcces(produit.id, {
                    niveauAccesEtablissement: String(fd.get('niveauAccesEtablissement') ?? ''),
                    motif: String(fd.get('motif') ?? '').trim(),
                  })
                }
                onSucces={() => {
 router.refresh();
 setRappelTarifs(true);
 }}
              >
                <ChampSelect
                  name="niveauAccesEtablissement"
                  label="Niveau d’accès aux établissements"
                  required
                  defaultValue={produit.niveauAccesEtablissement ?? 'POLYCLINIQUE'}
                  options={OPTIONS_CATEGORIE_ETABLISSEMENT}
                />
                <ChampTexte name="motif" label="Motif de la modification" required minLength={5} maxLength={500} />
              </FormulaireModal>
            )}
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
              produit.statut === 'PUBLIE' && peutGererPlan ? (
                <FormulaireModal
                  titre="Étendre la formule : ajouter une garantie"
                  description="Ajoute une couverture pour une catégorie d’acte aujourd’hui non couverte. Les polices de cette formule en bénéficient immédiatement ; les garanties existantes ne changent pas (pour les modifier, créez une nouvelle version)."
                  declencheurLabel="Ajouter une garantie"
                  libelleSoumettre="Étendre la formule"
                  onSoumettre={async (fd) => etendreProduitPublie(produit.id, lireGarantieFormData(fd))}
                  onSucces={() => {
 router.refresh();
 setRappelTarifs(true);
 }}
                >
                  <ChampsGarantie exclues={produit.garanties.map((g) => g.categorieActe)} />
                </FormulaireModal>
              ) : brouillon && peutGererPlan ? (
                <FormulaireModal
                  titre="Ajouter une garantie"
                  description="Une ligne de couverture par catégorie d’acte."
                  declencheurLabel="Ajouter une garantie"
                  libelleSoumettre="Ajouter la garantie"
                  onSoumettre={async (fd) =>
                    ajouterGarantie(produit.id, lireGarantieFormData(fd))
                  }
                  onSucces={() => {
 router.refresh();
 setRappelTarifs(true);
 }}
                >
                  <ChampsGarantie />
                </FormulaireModal>
              ) : undefined
            }
            actionLigne={
              produit.statut === 'PUBLIE' && peutGererPlan
                ? (g) => (
                    <FormulaireModal
                      titre="Modifier la garantie"
                      description="Formule publiée : la modification s’applique aux soins à venir de toutes ses polices ; les factures et remboursements déjà calculés ne changent pas."
                      declencheur={
                        <Button type="button" size="xs" variant="ghost">
                          Modifier
                        </Button>
                      }
                      libelleSoumettre="Enregistrer"
                      onSoumettre={async (fd) => modifierGarantie(produit.id, g.id, lireGarantieFormData(fd))}
                      onSucces={() => {
 router.refresh();
 setRappelTarifs(true);
 }}
                    >
                      <ChampsGarantie defaut={g} avecMotif exclues={produit.garanties.filter((x) => x.id !== g.id).map((x) => x.categorieActe)} />
                    </FormulaireModal>
                  )
                : brouillon && peutGererPlan
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
                        onSucces={() => {
 router.refresh();
 setRappelTarifs(true);
 }}
                      >
                        <ChampsGarantie defaut={g} />
                      </FormulaireModal>
                      <ConfirmationAction
                        action="supprimer"
                        element={`la garantie « ${libelleCategorieActe(g.categorieActe)} »`}
                        consequence="Le produit est encore en brouillon : la garantie disparaît de sa liste."
                        verifier={() => verifierAction('garantie', g.id, 'supprimer')}
                        onConfirmer={() => supprimerGarantie(produit.id, g.id)}
                        onSucces={() => {
 router.refresh();
 setRappelTarifs(true);
 }}
                        declencheur={
                          <Button type="button" size="xs" variant="ghost">
                            Retirer
                          </Button>
                        }
                      />
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
        {!archive && peutGererPlan && modaleAjusterTarifs(<Button variant="outline">Ajuster les tarifs</Button>)}
        {produit.statut === 'PUBLIE' && produit.version > 1 && peutGererPlan && (
          <FormulaireModal
            titre="Appliquer cette version aux polices"
            mode="center"
            description="Toutes les polices ACTIVES des versions précédentes de cette formule passent à celle-ci (avenant « changement de formule » daté d’aujourd’hui). Les soins déjà traités gardent leurs anciennes garanties."
            declencheur={<Button variant="outline">Appliquer aux polices actives</Button>}
            libelleSoumettre="Appliquer"
            onSoumettre={async () => changerFormuleEnMasse(produit.id)}
            onSucces={() => router.refresh()}
          >
            <p className="text-sm text-muted-foreground">
              Version {produit.version} de « {produit.nom} ».
            </p>
          </FormulaireModal>
        )}
        {!archive && peutGererPlan && (
          <ConfirmationAction
            action="archiver"
            element={`le produit « ${produit.nom} » v${produit.version}`}
            consequence="Il n'est plus proposé pour de nouvelles polices ; les polices en cours ne changent pas."
            verifier={() => verifierAction('produit', produit.id, 'archiver')}
            onConfirmer={() => archiverProduit(produit.id)}
            onSucces={() => router.refresh()}
            declencheur={<Button variant="outline">Archiver</Button>}
          />
        )}
        {archive && peutGererPlan && (
          <ConfirmationAction
            action="desarchiver"
            element={`le produit « ${produit.nom} » v${produit.version}`}
            consequence="Il redevient publié, à condition qu'aucune autre version du même produit ne le soit."
            verifier={() => verifierAction('produit', produit.id, 'desarchiver')}
            onConfirmer={() => desarchiverProduit(produit.id)}
            onSucces={() => router.refresh()}
            declencheur={<Button variant="outline">Désarchiver</Button>}
          />
        )}
        {brouillon && peutGererPlan && (
          <ConfirmationAction
            action="supprimer"
            element={`le brouillon « ${produit.nom} » v${produit.version}`}
            consequence={`Ses ${produit.garanties.length} garantie${produit.garanties.length > 1 ? 's' : ''} sont supprimée${produit.garanties.length > 1 ? 's' : ''} avec lui, si aucune n'est utilisée.`}
            verifier={() => verifierAction('produit', produit.id, 'supprimer')}
            onConfirmer={() => supprimerProduit(produit.id)}
            onSucces={() => router.push('/dashboard-assureur/informatique/produits')}
            declencheur={<Button variant="outline">Supprimer</Button>}
          />
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
