'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  creerActeNational,
  changerStatutItemNational,
  creerMedicamentNational,
  modifierActeNational,
  supprimerItemNational,
  type ImportCatalogueResume,
} from '@/app/superadmin/catalogue-national/actions';
import {
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImportsCataloguePanel } from '@/components/superadmin/imports-catalogue-panel';
import { Stethoscope, Pill } from 'lucide-react';
import { LIBELLE_MODE_COTATION, LIBELLE_STATUT_HOMOLOGATION } from '@/lib/referentiel';
import { Button } from '@/components/ui/button';
import { ChampNombre } from '@/components/dashboard/patterns';
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
}

export function CatalogueNationalEcran({
  actes,
  medicaments,
  imports,
  lettresCles = [],
}: {
  actes: ActeNational[];
  medicaments: MedicamentNational[];
  imports: ImportCatalogueResume[];
  lettresCles?: LettreCleOption[];
}) {
  const { libelle: libelleCategorieActe, options: optionsCategories } = useCategoriesActe();
  const router = useRouter();
  const [voirArchives, setVoirArchives] = useState(false);
  const actesVisibles = voirArchives ? actes : actes.filter((a) => a.statut !== 'RETIRE');
  const medicamentsVisibles = voirArchives ? medicaments : medicaments.filter((m) => m.statutHomologation !== 'RETIRE');
  const nbArchives =
    actes.filter((a) => a.statut === 'RETIRE').length +
    medicaments.filter((m) => m.statutHomologation === 'RETIRE').length;

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
    { cle: 'denominationCommune', entete: 'DCI', triable: true },
    {
      cle: 'presentation',
      entete: 'Présentation',
      rendu: (m) => [m.forme, m.dosage].filter(Boolean).join(' · ') || '—',
    },
    {
      cle: 'classeTherapeutique',
      entete: 'Classe',
      rendu: (m) => m.classeTherapeutique ?? '—',
    },
    {
      cle: 'statutHomologation',
      entete: 'Statut',
      rendu: (m) => <StatutBadge
          statut={m.statutHomologation}
          libelles={LIBELLE_STATUT_HOMOLOGATION}
        />,
    },
  ];

  return (
    <div className="space-y-8">
      <GrilleCartes>
        <CarteResume libelle="Actes nationaux" valeur={actes.length} icon={Stethoscope} />
        <CarteResume
          libelle="Médicaments nationaux"
          valeur={medicaments.length}
          icon={Pill}
        />
      </GrilleCartes>

      {nbArchives > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={voirArchives} onChange={(e) => setVoirArchives(e.target.checked)} />
          Archivés (retirés du catalogue : {nbArchives})
        </label>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actes</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={actesVisibles}
            cleLigne={(a) => a.id}
            parPage={10}
            recherche={{ placeholder: 'Code, libellé…', champs: ['code', 'libelle'] }}
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
        </CardContent>
      </Card>

      <ImportsCataloguePanel type="actes" imports={imports} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Médicaments</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={medicamentsVisibles}
            cleLigne={(m) => m.id}
            parPage={10}
            recherche={{
              placeholder: 'DCI, classe…',
              champs: ['denominationCommune', 'classeTherapeutique'],
            }}
            colonnes={colMed}
            actions={
              <FormulaireModal
                titre="Nouveau médicament national"
                declencheurLabel="Ajouter un médicament"
                libelleSoumettre="Ajouter au catalogue"
                onSoumettre={async (fd) =>
                  creerMedicamentNational({
                    denominationCommune: String(fd.get('denominationCommune') ?? ''),
                    forme: String(fd.get('forme') ?? '') || undefined,
                    dosage: String(fd.get('dosage') ?? '') || undefined,
                    classeTherapeutique:
                      String(fd.get('classeTherapeutique') ?? '') || undefined,
                    usage: String(fd.get('usage') ?? '') || undefined,
                  })
                }
                onSucces={() => router.refresh()}
              >
                <ChampTexte
                  name="denominationCommune"
                  label="Dénomination commune (DCI)"
                  required
                  placeholder="Paracétamol"
                />
                <ChampTexte name="forme" label="Forme" placeholder="Comprimé" />
                <ChampTexte name="dosage" label="Dosage" placeholder="500 mg" />
                <ChampTexte
                  name="classeTherapeutique"
                  label="Classe thérapeutique"
                />
                <ChampSelect
                  name="usage"
                  label="Usage"
                  placeholder="—"
                  options={[
                    { valeur: 'AMBULATOIRE', libelle: 'Ambulatoire' },
                    { valeur: 'HOSPITALIER', libelle: 'Hospitalier' },
                    { valeur: 'LES_DEUX', libelle: 'Les deux' },
                  ]}
                />
              </FormulaireModal>
            }
            actionLigne={(m) => (
              <span className="flex justify-end gap-2">
                {m.statutHomologation === 'RETIRE' ? (
                  <ConfirmationAction
                    action="desarchiver"
                    element={`le médicament « ${m.denominationCommune} »`}
                    consequence="Il est de nouveau homologué et importable."
                    verifier={() => verifierAction('medicamentNational', m.id, 'desarchiver')}
                    onConfirmer={() => changerStatutItemNational('medicaments', m.id, 'reactiver')}
                    onSucces={() => router.refresh()}
                  />
                ) : (
                  <ConfirmationAction
                    action="archiver"
                    element={`le médicament « ${m.denominationCommune} »`}
                    consequence="Il n'est plus importable ; les copies déjà importées ne changent pas."
                    verifier={() => verifierAction('medicamentNational', m.id, 'archiver')}
                    onConfirmer={() => changerStatutItemNational('medicaments', m.id, 'retirer')}
                    onSucces={() => router.refresh()}
                  />
                )}
                <ConfirmationAction
                  action="supprimer"
                  element={`le médicament « ${m.denominationCommune} »`}
                  consequence="Il ne pourra plus être importé par les organisations."
                  verifier={() => verifierAction('medicamentNational', m.id, 'supprimer')}
                  onConfirmer={() => supprimerItemNational('medicaments', m.id)}
                  onSucces={() => router.refresh()}
                />
              </span>
            )}
            vide="Aucun médicament dans le catalogue national."
          />
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
