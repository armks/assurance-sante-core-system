'use client';

import { useRouter } from 'next/navigation';

import {
  creerActeNational,
  creerMedicamentNational,
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
import { LIBELLE_STATUT_HOMOLOGATION } from '@/lib/referentiel';
import { useCategoriesActe } from '@/components/categories-acte';

export interface ActeNational {
  id: string;
  code: string;
  libelle: string;
  categorie: string | null;
  versionNomenclature: string | null;
  statut: string;
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
}: {
  actes: ActeNational[];
  medicaments: MedicamentNational[];
  imports: ImportCatalogueResume[];
}) {
  const { libelle: libelleCategorieActe, options: optionsCategories } = useCategoriesActe();
  const router = useRouter();

  const colActes: ColonneTable<ActeNational>[] = [
    { cle: 'code', entete: 'Code', triable: true, className: 'font-mono text-xs' },
    { cle: 'libelle', entete: 'Libellé', triable: true },
    {
      cle: 'categorie',
      entete: 'Catégorie',
      valeur: (a) => libelleCategorieActe(a.categorie),
      rendu: (a) => libelleCategorieActe(a.categorie),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => <StatutBadge statut={a.statut} libelles={LIBELLE_STATUT_HOMOLOGATION} />,
    },
  ];

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actes</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={actes}
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
                  })
                }
                onSucces={() => router.refresh()}
              >
                <ChampTexte name="code" label="Code" required placeholder="CI-CONS-GEN" />
                <ChampTexte name="libelle" label="Libellé" required />
                <ChampSelect
                  name="categorie"
                  label="Catégorie"
                  placeholder="Choisir…"
                  options={optionsCategories()}
                />
                <ChampTexte
                  name="versionNomenclature"
                  label="Version de nomenclature"
                  placeholder="CI-2026"
                />
              </FormulaireModal>
            }
            actionLigne={(a) => (
              // Confirmation partagée (ADR-007) : vérifie côté serveur, refusée si un
              // organisme a déjà importé l'acte
              <ConfirmationAction
                action="supprimer"
                element={`l’acte « ${a.code} — ${a.libelle} »`}
                consequence="Il ne pourra plus être importé par les organisations."
                verifier={() => verifierAction('acteNational', a.id, 'supprimer')}
                onConfirmer={() => supprimerItemNational('actes', a.id)}
                onSucces={() => router.refresh()}
              />
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
            donnees={medicaments}
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
              <ConfirmationAction
                action="supprimer"
                element={`le médicament « ${m.denominationCommune} »`}
                consequence="Il ne pourra plus être importé par les organisations."
                verifier={() => verifierAction('medicamentNational', m.id, 'supprimer')}
                onConfirmer={() => supprimerItemNational('medicaments', m.id)}
                onSucces={() => router.refresh()}
              />
            )}
            vide="Aucun médicament dans le catalogue national."
          />
        </CardContent>
      </Card>

      <ImportsCataloguePanel type="medicaments" imports={imports} />
    </div>
  );
}
