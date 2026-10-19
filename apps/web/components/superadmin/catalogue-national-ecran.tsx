'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  creerActeNational,
  changerStatutItemNational,
  creerMedicamentNational,
  modifierActeNational,
  modifierMedicamentNational,
  supprimerItemNational,
  type ImportCatalogueResume,
  type ResultatActionMasse,
} from '@/app/superadmin/catalogue-national/actions';
import {
  ChampCheckbox,
  ChampSelect,
  ConfirmationAction,
  ChampTexte,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  CarteResume,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { verifierAction } from '@/app/dependances-actions';
import { homologuerItemNational } from '@/app/superadmin/catalogue-national/actions';
import { ActionsMasseCatalogue, ResultatMasse } from '@/components/superadmin/actions-masse-catalogue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImportsCataloguePanel } from '@/components/superadmin/imports-catalogue-panel';
import { Stethoscope, Pill } from 'lucide-react';
import { LIBELLE_MODE_COTATION, LIBELLE_STATUT_HOMOLOGATION } from '@/lib/referentiel';
import { Button } from '@/components/ui/button';
import { ChampNombre, FiltresServeur, PaginationServeur, type PageServeur } from '@/components/dashboard/patterns';
import { useCategoriesActe } from '@/components/categories-acte';

export interface ActeNational {
  id: string;
  code: string;
  libelle: string;
  categorie: string | null;
  versionNomenclature: string | null;
  statut: string;
  // cotation (prisma/sql/080)
  lettreCleCode?: string | null;
  coefficient?: string | null;
  modeCotation?: string;
  categorieGarantie?: string | null;
  groupeCode?: string | null;
}
export interface LettreCleOption {
  code: string;
  libelle: string;
  actif: boolean;
}
export interface MedicamentNational {
  id: string;
  denominationCommune: string;
  forme: string | null;
  dosage: string | null;
  classeTherapeutique: string | null;
  usage: string | null;
  statutHomologation: string;
  nomCommercial?: string | null;
  codeEan?: string | null;
  codeProduit?: string | null;
  conditionnement?: string | null;
  remboursable?: boolean;
  categorieRemboursement?: string | null;
  regimeRemboursement?: string | null;
  typeMedicament?: string | null;
  tauxRemboursementStd?: string | null;
  prixReferenceXof?: string | null;
  prixMaxRemboursable?: string | null;
  medicamentEssentiel?: boolean;
  ordonnanceObligatoire?: boolean;
  medicamentControle?: boolean;
}

/** Colonnes de la liste officielle des médicaments remboursables (MUGEF-CI). */
const CATEGORIES_REMBOURSEMENT = [
  { valeur: 'R', libelle: 'R' },
  { valeur: 'EP', libelle: 'EP — entente préalable' },
  { valeur: 'EPF', libelle: 'EPF' },
  { valeur: 'TPC', libelle: 'TPC' },
  { valeur: 'LIBRE', libelle: 'LIBRE' },
];
const REGIMES_REMBOURSEMENT = [
  { valeur: 'RCO', libelle: 'RCO' },
  { valeur: 'IVSPL', libelle: 'IVSPL' },
];
const TYPES_MEDICAMENT = [
  { valeur: 'G', libelle: 'G — générique' },
  { valeur: 'S', libelle: 'S — spécialité' },
];

const prixF = (v: string | null | undefined) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`);

/** Champs d'un médicament, dans l'ordre de la liste officielle ; le reste est facultatif. */
function ChampsMedicament({ m }: { m?: MedicamentNational }) {
  return (
    <>
      <ChampTexte name="codeProduit" label="Code produit" placeholder="3516715" inputMode="numeric" maxLength={9} defaultValue={m?.codeProduit ?? ''} aide="6 à 9 chiffres, unique." />
      <ChampTexte name="nomCommercial" label="Nom commercial" required placeholder="ACTISOUFRE PULV NAS FL100ML" defaultValue={m?.nomCommercial ?? ''} aide="Avec forme, dosage et conditionnement, comme dans la liste officielle." />
      <ChampTexte name="classeTherapeutique" label="Groupe thérapeutique" placeholder="Parasitologie, antipaludique" defaultValue={m?.classeTherapeutique ?? ''} />
      <ChampTexte name="denominationCommune" label="DCI" required placeholder="Artéméther + luméfantrine" defaultValue={m?.denominationCommune ?? ''} />
      <ChampSelect name="categorieRemboursement" label="Catégorie" placeholder="—" defaultValue={m?.categorieRemboursement ?? ''} options={CATEGORIES_REMBOURSEMENT} />
      <ChampSelect name="typeMedicament" label="Type" placeholder="—" defaultValue={m?.typeMedicament ?? ''} options={TYPES_MEDICAMENT} />
      <ChampNombre name="prixReferenceXof" label="Prix (F CFA)" min={0} step="1" defaultValue={m?.prixReferenceXof ?? ''} />
      <ChampSelect name="regimeRemboursement" label="Régime" placeholder="—" defaultValue={m?.regimeRemboursement ?? ''} options={REGIMES_REMBOURSEMENT} />
      <details className="rounded-md border p-3 text-sm" open={Boolean(m?.forme || m?.dosage || m?.conditionnement || m?.codeEan)}>
        <summary className="cursor-pointer font-medium">Compléments (facultatif)</summary>
        <div className="mt-3 grid gap-3">
          <ChampTexte name="forme" label="Forme" placeholder="Comprimé" defaultValue={m?.forme ?? ''} />
          <ChampTexte name="dosage" label="Dosage" placeholder="500 mg" defaultValue={m?.dosage ?? ''} />
          <ChampTexte name="conditionnement" label="Conditionnement" placeholder="B/30" defaultValue={m?.conditionnement ?? ''} />
          <ChampTexte name="codeEan" label="Code EAN" defaultValue={m?.codeEan ?? ''} />
          <ChampSelect
            name="usage"
            label="Usage"
            placeholder="—"
            defaultValue={m?.usage ?? ''}
            options={[
              { valeur: 'AMBULATOIRE', libelle: 'Ambulatoire' },
              { valeur: 'HOSPITALIER', libelle: 'Hospitalier' },
              { valeur: 'LES_DEUX', libelle: 'Les deux' },
            ]}
          />
          <ChampNombre name="tauxRemboursementStd" label="Taux de remboursement (%)" min={0} max={100} step="0.01" defaultValue={m?.tauxRemboursementStd ?? ''} />
          <ChampNombre name="prixMaxRemboursable" label="Prix maximum remboursable (F CFA)" min={0} step="0.01" defaultValue={m?.prixMaxRemboursable ?? ''} />
          <ChampCheckbox name="medicamentEssentiel" label="Médicament essentiel" defaultChecked={m?.medicamentEssentiel ?? false} />
          <ChampCheckbox name="ordonnanceObligatoire" label="Ordonnance obligatoire" defaultChecked={m?.ordonnanceObligatoire ?? true} />
          <ChampCheckbox name="medicamentControle" label="Médicament contrôlé" defaultChecked={m?.medicamentControle ?? false} />
        </div>
      </details>
    </>
  );
}

/** Corps de requête d'un médicament depuis le formulaire : champ vide → `null` (efface) en modification, absent en création. */
function corpsMedicament(fd: FormData, modification: boolean): { denominationCommune: string } & Record<string, string | number | boolean | null | undefined> {
  const t = (k: string) => String(fd.get(k) ?? '').trim();
  const texte = (k: string) => t(k) || (modification ? null : undefined);
  const nombre = (k: string) => (t(k) === '' ? (modification ? null : undefined) : Number(t(k)));
  return {
    codeProduit: texte('codeProduit'),
    nomCommercial: texte('nomCommercial'),
    classeTherapeutique: texte('classeTherapeutique'),
    denominationCommune: t('denominationCommune'),
    categorieRemboursement: texte('categorieRemboursement'),
    typeMedicament: texte('typeMedicament'),
    regimeRemboursement: texte('regimeRemboursement'),
    prixReferenceXof: nombre('prixReferenceXof'),
    forme: texte('forme'),
    dosage: texte('dosage'),
    conditionnement: texte('conditionnement'),
    codeEan: texte('codeEan'),
    usage: texte('usage'),
    tauxRemboursementStd: nombre('tauxRemboursementStd'),
    prixMaxRemboursable: nombre('prixMaxRemboursable'),
    remboursable: true,
    medicamentEssentiel: fd.get('medicamentEssentiel') === 'on',
    ordonnanceObligatoire: fd.get('ordonnanceObligatoire') === 'on',
    medicamentControle: fd.get('medicamentControle') === 'on',
  };
}

export function CatalogueNationalEcran({
  pageActes,
  nbArchivesActes,
  pageMedicaments,
  nbArchivesMedicaments,
  imports,
  lettresCles = [],
}: {
  /** Actes : liste PAGINÉE côté serveur (la nomenclature officielle compte plus de 9 000 actes). */
  pageActes: PageServeur<ActeNational>;
  /** Nombre d'actes archivés (retirés), tous actes confondus. */
  nbArchivesActes: number;
  /** Médicaments : liste PAGINÉE côté serveur (la liste officielle compte plus de 4 700 produits). */
  pageMedicaments: PageServeur<MedicamentNational>;
  /** Nombre de médicaments archivés (retirés). */
  nbArchivesMedicaments: number;
  imports: ImportCatalogueResume[];
  lettresCles?: LettreCleOption[];
}) {
  const { libelle: libelleCategorieActe, options: optionsCategories } = useCategoriesActe();
  const router = useRouter();
  // actions de masse : sélection limitée à la page affichée de chaque tableau, résultat détaillé
  const [selActes, setSelActes] = useState<Set<string>>(new Set());
  const [selMeds, setSelMeds] = useState<Set<string>>(new Set());
  const [resultatMasse, setResultatMasse] = useState<ResultatActionMasse | null>(null);
  const apresMasse = (r: ResultatActionMasse) => {
    setResultatMasse(r);
    setSelActes(new Set());
    setSelMeds(new Set());
    router.refresh();
  };
  const actesVisibles = pageActes.items;
  const medicamentsVisibles = pageMedicaments.items;

  const colActes: ColonneTable<ActeNational>[] = [
    { cle: 'code', entete: 'Code', triable: true, className: 'font-mono text-xs' },
    { cle: 'libelle', entete: 'Libellé', triable: true },
    {
      cle: 'categorie',
      entete: 'Chapitre',
      valeur: (a) => a.categorie ?? '',
      rendu: (a) => a.categorie ?? '—',
    },
    {
      cle: 'cotation',
      entete: 'Cotation',
      valeur: (a) => (a.lettreCleCode ? `${a.lettreCleCode} ${a.coefficient ?? ''}` : ''),
      rendu: (a) =>
        a.lettreCleCode ? (
          <span>
            <span className="font-mono font-semibold">{a.lettreCleCode}</span> × {Number(a.coefficient ?? 0).toLocaleString('fr-FR')}
            <span className="block text-xs text-muted-foreground">
              {LIBELLE_MODE_COTATION[a.modeCotation ?? 'ISOLE'] ?? a.modeCotation}
              {a.groupeCode ? ` · groupe ${a.groupeCode}` : ''}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Non cotée</span>
        ),
    },
    {
      cle: 'categorieGarantie',
      entete: 'Garantie',
      valeur: (a) => libelleCategorieActe(a.categorieGarantie ?? null),
      rendu: (a) => libelleCategorieActe(a.categorieGarantie ?? null),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => <StatutBadge statut={a.statut} libelles={LIBELLE_STATUT_HOMOLOGATION} />,
    },
  ];

  const optionsLettres = lettresCles.filter((l) => l.actif).map((l) => ({ valeur: l.code, libelle: `${l.code} — ${l.libelle}` }));
  const optionsMode = Object.entries(LIBELLE_MODE_COTATION).map(([valeur, libelle]) => ({ valeur, libelle }));
  const lire = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
  const cotationDe = (fd: FormData) => ({
    lettreCleCode: lire(fd, 'lettreCleCode') || null,
    coefficient: lire(fd, 'coefficient') || null,
    modeCotation: lire(fd, 'modeCotation') || 'ISOLE',
    categorieGarantie: lire(fd, 'categorieGarantie') || null,
    groupeCode: lire(fd, 'groupeCode') || null,
  });

  const colMed: ColonneTable<MedicamentNational>[] = [
    { cle: 'codeProduit', entete: 'Code produit', className: 'font-mono text-xs', rendu: (m) => m.codeProduit ?? '—' },
    { cle: 'nomCommercial', entete: 'Nom commercial', rendu: (m) => m.nomCommercial ?? '—' },
    { cle: 'classeTherapeutique', entete: 'Groupe thérapeutique', rendu: (m) => m.classeTherapeutique ?? '—' },
    { cle: 'denominationCommune', entete: 'DCI' },
    { cle: 'categorieRemboursement', entete: 'Catégorie', rendu: (m) => m.categorieRemboursement ?? '—' },
    { cle: 'typeMedicament', entete: 'Type', rendu: (m) => m.typeMedicament ?? '—' },
    { cle: 'prixReferenceXof', entete: 'Prix', aligneDroite: true, rendu: (m) => prixF(m.prixReferenceXof) },
    { cle: 'regimeRemboursement', entete: 'Régime', rendu: (m) => m.regimeRemboursement ?? '—' },
    {
      cle: 'statutHomologation',
      entete: 'Statut',
      rendu: (m) => <StatutBadge statut={m.statutHomologation} libelles={LIBELLE_STATUT_HOMOLOGATION} />,
    },
  ];

  return (
    <div className="space-y-8">
      <GrilleCartes>
        <CarteResume libelle="Actes nationaux" valeur={pageActes.total.toLocaleString('fr-FR')} icon={Stethoscope} indice={nbArchivesActes > 0 ? `dont ${nbArchivesActes} archivé(s)` : undefined} />
        <CarteResume
          libelle="Médicaments nationaux"
          valeur={pageMedicaments.total.toLocaleString('fr-FR')}
          indice={nbArchivesMedicaments > 0 ? `dont ${nbArchivesMedicaments} archivé(s)` : undefined}
          icon={Pill}
        />
      </GrilleCartes>


      {resultatMasse && <ResultatMasse resultat={resultatMasse} onFermer={() => setResultatMasse(null)} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FiltresServeur
            recherche={{ placeholder: 'Code, libellé ou chapitre…' }}
            selects={[
              {
                cle: 'statut',
                libelle: 'Statut',
                options: Object.entries(LIBELLE_STATUT_HOMOLOGATION).map(([valeur, libelle]) => ({ valeur, libelle })),
              },
            ]}
          />
          <DataTable
            donnees={actesVisibles}
            cleLigne={(a) => a.id}
            parPage={0}
            selection={{
              ids: selActes,
              onChange: setSelActes,
              barre: (lignes) => (
                <ActionsMasseCatalogue
                  type="actes"
                  elements={lignes.map((a) => ({ id: a.id, nom: `${a.code} — ${a.libelle}`, archive: a.statut === 'RETIRE' }))}
                  onTermine={apresMasse}
                />
              ),
            }}
            colonnes={colActes}
            actions={
              <FormulaireModal
                titre="Nouvel acte national"
                declencheurLabel="Ajouter un acte"
                libelleSoumettre="Ajouter au catalogue"
                onSoumettre={async (fd) =>
                  creerActeNational({
                    code: String(fd.get('code') ?? ''),
                    libelle: String(fd.get('libelle') ?? ''),
                    categorie: String(fd.get('categorie') ?? '') || undefined,
                    versionNomenclature:
                      String(fd.get('versionNomenclature') ?? '') || undefined,
                    ...Object.fromEntries(Object.entries(cotationDe(fd)).filter(([, v]) => v !== null)),
                  })
                }
                onSucces={() => router.refresh()}
              >
                <ChampTexte name="code" label="Code" required placeholder="CI-CONS-GEN" />
                <ChampTexte name="libelle" label="Libellé" required />
                <ChampTexte name="categorie" label="Chapitre de la nomenclature" placeholder="Ex. Biologie médicale" />
                <ChampTexte
                  name="versionNomenclature"
                  label="Version de nomenclature"
                  placeholder="CI-2026"
                />
                <ChampsCotation optionsLettres={optionsLettres} optionsMode={optionsMode} optionsGarantie={optionsCategories()} />
              </FormulaireModal>
            }
            actionLigne={(a) => (
              // Confirmation partagée (ADR-007) : vérifie côté serveur, refusée si un
              // organisme a déjà importé l'acte
              <span className="flex justify-end gap-2">
                <FormulaireModal
                  titre={`Modifier l’acte ${a.code}`}
                  mode="center"
                  declencheur={<Button size="xs" variant="ghost">Modifier</Button>}
                  libelleSoumettre="Enregistrer"
                  onSoumettre={async (fd) =>
                    modifierActeNational(a.id, {
                      libelle: lire(fd, 'libelle'),
                      categorie: lire(fd, 'categorie') || null,
                      ...cotationDe(fd),
                    })
                  }
                  onSucces={() => router.refresh()}
                >
                  <ChampTexte name="libelle" label="Libellé" required defaultValue={a.libelle} />
                  <ChampTexte name="categorie" label="Chapitre de la nomenclature" defaultValue={a.categorie ?? ''} />
                  <ChampsCotation
                    optionsLettres={optionsLettres}
                    optionsMode={optionsMode}
                    optionsGarantie={optionsCategories()}
                    defauts={a}
                  />
                </FormulaireModal>
                {a.statut === 'PROPOSE' && (
                  <Button size="xs" variant="ghost" onClick={async () => { await homologuerItemNational('actes', a.id); router.refresh(); }}>
                    Homologuer
                  </Button>
                )}
                {a.statut === 'RETIRE' ? (
                  <ConfirmationAction
                    action="desarchiver"
                    element={`l’acte « ${a.code} — ${a.libelle} »`}
                    consequence="Il est de nouveau homologué et importable."
                    verifier={() => verifierAction('acteNational', a.id, 'desarchiver')}
                    onConfirmer={() => changerStatutItemNational('actes', a.id, 'reactiver')}
                    onSucces={() => router.refresh()}
                  />
                ) : (
                  <ConfirmationAction
                    action="archiver"
                    element={`l’acte « ${a.code} — ${a.libelle} »`}
                    consequence="Il n'est plus importable ; les copies déjà importées ne changent pas."
                    verifier={() => verifierAction('acteNational', a.id, 'archiver')}
                    onConfirmer={() => changerStatutItemNational('actes', a.id, 'retirer')}
                    onSucces={() => router.refresh()}
                  />
                )}
                <ConfirmationAction
                  action="supprimer"
                  element={`l’acte « ${a.code} — ${a.libelle} »`}
                  consequence="Il ne pourra plus être importé par les organisations."
                  verifier={() => verifierAction('acteNational', a.id, 'supprimer')}
                  onConfirmer={() => supprimerItemNational('actes', a.id)}
                  onSucces={() => router.refresh()}
                />
              </span>
            )}
            vide="Aucun acte dans le catalogue national."
          />
          <PaginationServeur page={pageActes.page} pages={pageActes.pages} total={pageActes.total} limite={pageActes.limite} />
        </CardContent>
      </Card>

      <ImportsCataloguePanel type="actes" imports={imports} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Médicaments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FiltresServeur
            prefixe="m"
            recherche={{ placeholder: 'Nom commercial, DCI, groupe ou code produit…' }}
            selects={[
              {
                cle: 'statut',
                libelle: 'Statut',
                options: Object.entries(LIBELLE_STATUT_HOMOLOGATION).map(([valeur, libelle]) => ({ valeur, libelle })),
              },
            ]}
          />
          <DataTable
            donnees={medicamentsVisibles}
            cleLigne={(m) => m.id}
            parPage={0}
            selection={{
              ids: selMeds,
              onChange: setSelMeds,
              barre: (lignes) => (
                <ActionsMasseCatalogue
                  type="medicaments"
                  elements={lignes.map((m) => ({ id: m.id, nom: m.nomCommercial ?? m.denominationCommune, archive: m.statutHomologation === 'RETIRE' }))}
                  onTermine={apresMasse}
                />
              ),
            }}
            colonnes={colMed}
            actions={
              <FormulaireModal
                titre="Nouveau médicament national"
                declencheurLabel="Ajouter un médicament"
                libelleSoumettre="Ajouter au catalogue"
                onSoumettre={async (fd) => creerMedicamentNational(corpsMedicament(fd, false))}
                onSucces={() => router.refresh()}
              >
                <ChampsMedicament />
              </FormulaireModal>
            }
            actionLigne={(m) => (
              <span className="flex justify-end gap-2">
                <FormulaireModal
                  titre={`Modifier « ${m.nomCommercial ?? m.denominationCommune} »`}
                  mode="right"
                  declencheur={<Button size="xs" variant="ghost">Modifier</Button>}
                  libelleSoumettre="Enregistrer"
                  onSoumettre={async (fd) => modifierMedicamentNational(m.id, corpsMedicament(fd, true))}
                  onSucces={() => router.refresh()}
                >
                  <ChampsMedicament m={m} />
                </FormulaireModal>
                {m.statutHomologation === 'PROPOSE' && (
                  <Button size="xs" variant="ghost" onClick={async () => { await homologuerItemNational('medicaments', m.id); router.refresh(); }}>
                    Homologuer
                  </Button>
                )}
                {m.statutHomologation === 'RETIRE' ? (
                  <ConfirmationAction
                    action="desarchiver"
                    element={`le médicament « ${m.nomCommercial ?? m.denominationCommune} »`}
                    consequence="Il est de nouveau homologué et importable."
                    verifier={() => verifierAction('medicamentNational', m.id, 'desarchiver')}
                    onConfirmer={() => changerStatutItemNational('medicaments', m.id, 'reactiver')}
                    onSucces={() => router.refresh()}
                  />
                ) : (
                  <ConfirmationAction
                    action="archiver"
                    element={`le médicament « ${m.nomCommercial ?? m.denominationCommune} »`}
                    consequence="Il n'est plus importable ; les copies déjà importées ne changent pas."
                    verifier={() => verifierAction('medicamentNational', m.id, 'archiver')}
                    onConfirmer={() => changerStatutItemNational('medicaments', m.id, 'retirer')}
                    onSucces={() => router.refresh()}
                  />
                )}
                <ConfirmationAction
                  action="supprimer"
                  element={`le médicament « ${m.nomCommercial ?? m.denominationCommune} »`}
                  consequence="Il ne pourra plus être importé par les organisations."
                  verifier={() => verifierAction('medicamentNational', m.id, 'supprimer')}
                  onConfirmer={() => supprimerItemNational('medicaments', m.id)}
                  onSucces={() => router.refresh()}
                />
              </span>
            )}
            vide="Aucun médicament dans le catalogue national."
          />
          <PaginationServeur prefixe="m" page={pageMedicaments.page} pages={pageMedicaments.pages} total={pageMedicaments.total} limite={pageMedicaments.limite} />
        </CardContent>
      </Card>

      <ImportsCataloguePanel type="medicaments" imports={imports} />
    </div>
  );
}

/** Champs de cotation (lettre-clé × coefficient, mode, garantie, groupe) — aucun prix en FCFA. */
function ChampsCotation({
  optionsLettres,
  optionsMode,
  optionsGarantie,
  defauts,
}: {
  optionsLettres: { valeur: string; libelle: string }[];
  optionsMode: { valeur: string; libelle: string }[];
  optionsGarantie: { valeur: string; libelle: string }[];
  defauts?: ActeNational;
}) {
  const [mode, setMode] = useState(defauts?.modeCotation ?? 'ISOLE');
  return (
    <>
      <ChampSelect
        name="lettreCleCode"
        label="Lettre-clé"
        defaultValue={defauts?.lettreCleCode ?? ''}
        options={[{ valeur: '', libelle: 'Aucune (acte non coté)' }, ...optionsLettres]}
      />
      <ChampNombre name="coefficient" label="Coefficient" min={0} step="0.01" defaultValue={defauts?.coefficient ?? undefined} aide="Obligatoire avec une lettre-clé." />
      <ChampSelect
        name="modeCotation"
        label="Mode de cotation"
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        options={optionsMode}
      />
      {mode === 'GROUPE' && (
        <ChampTexte name="groupeCode" label="Code du groupe" required defaultValue={defauts?.groupeCode ?? ''} />
      )}
      <ChampSelect
        name="categorieGarantie"
        label="Catégorie de garantie"
        defaultValue={defauts?.categorieGarantie ?? ''}
        options={[{ valeur: '', libelle: 'Non renseignée' }, ...optionsGarantie]}
      />
    </>
  );
}
