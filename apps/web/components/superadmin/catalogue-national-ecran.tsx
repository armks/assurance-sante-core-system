'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  creerActeNational,
  creerMedicamentNational,
  supprimerItemNational,
  type ImportCatalogueResume,
} from '@/app/superadmin/catalogue-national/actions';
import {
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  CarteResume,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImportsCataloguePanel } from '@/components/superadmin/imports-catalogue-panel';
import { Stethoscope, Pill } from 'lucide-react';

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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const retirer = (type: 'actes' | 'medicaments', id: string) =>
    start(async () => {
      setErreur(null);
      const r = await supprimerItemNational(type, id);
      if (r.ok) router.refresh();
      else setErreur(r.error);
    });

  const colActes: ColonneTable<ActeNational>[] = [
    { cle: 'code', entete: 'Code', triable: true, className: 'font-mono text-xs' },
    { cle: 'libelle', entete: 'Libellé', triable: true },
    { cle: 'categorie', entete: 'Catégorie', rendu: (a) => a.categorie ?? '—' },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => <StatutBadge statut={a.statut} />,
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
      rendu: (m) => <StatutBadge statut={m.statutHomologation} />,
    },
  ];

  return (
    <div className="space-y-8">
      {erreur && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {erreur}
        </div>
      )}

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
                <ChampTexte name="categorie" label="Catégorie" placeholder="CONSULTATION" />
                <ChampTexte
                  name="versionNomenclature"
                  label="Version de nomenclature"
                  placeholder="CI-2026"
                />
              </FormulaireModal>
            }
            actionLigne={(a) => (
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => retirer('actes', a.id)}
              >
                Retirer
              </Button>
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
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => retirer('medicaments', m.id)}
              >
                Retirer
              </Button>
            )}
            vide="Aucun médicament dans le catalogue national."
          />
        </CardContent>
      </Card>

      <ImportsCataloguePanel type="medicaments" imports={imports} />
    </div>
  );
}
