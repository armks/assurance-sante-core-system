'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { verifierAction, type VerdictsListe } from '@/app/dependances-actions';
import {
  proposerActe,
  proposerMedicament,
  reproposerActe,
  reproposerMedicament,
  supprimerActe,
  supprimerMedicament,
} from '@/app/dashboard-assureur/reference-actions';
import {
  Alerte,
  ConfirmationAction,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { LIBELLE_STATUT_HOMOLOGATION } from '@/lib/referentiel';
import { useCategoriesActe } from '@/components/categories-acte';

export interface ActeReferentiel {
  id: string;
  code: string;
  libelle: string;
  categorie: string | null;
  statut: string;
}

export interface MedicamentReferentiel {
  id: string;
  denominationCommune: string;
  forme: string | null;
  dosage: string | null;
  classeTherapeutique: string | null;
  statutHomologation: string;
}

export function ReferentielMedicalEcran({
  actes,
  medicaments,
  peutProposer,
  verdictsActes = {},
  verdictsMedicaments = {},
}: {
  actes: ActeReferentiel[];
  medicaments: MedicamentReferentiel[];
  /** `true` uniquement si ASSUREUR_INFORMATIQUE figure dans la chaîne de
   * rôles — droit exclusif côté API (ROLE_PROPOSITION). */
  peutProposer: boolean;
  /** Verdicts « action possible ? » par acte / médicament (boutons grisés avec la raison). */
  verdictsActes?: VerdictsListe;
  verdictsMedicaments?: VerdictsListe;
}) {
  const { libelle: libelleCategorieActe, options: optionsCategories } = useCategoriesActe();
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [voirArchives, setVoirArchives] = useState(false);
  const actesVisibles = voirArchives ? actes : actes.filter((a) => a.statut !== 'RETIRE');
  const medicamentsVisibles = voirArchives ? medicaments : medicaments.filter((m) => m.statutHomologation !== 'RETIRE');
  const nbArchives =
    actes.filter((a) => a.statut === 'RETIRE').length +
    medicaments.filter((m) => m.statutHomologation === 'RETIRE').length;

  const colActes: ColonneTable<ActeReferentiel>[] = [
    { cle: 'libelle', entete: 'Libellé', triable: true },
    { cle: 'code', entete: 'Code' },
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

  const colMedicaments: ColonneTable<MedicamentReferentiel>[] = [
    { cle: 'denominationCommune', entete: 'DCI', triable: true },
    {
      cle: 'forme',
      entete: 'Forme / dosage',
      rendu: (m) => [m.forme, m.dosage].filter(Boolean).join(' — ') || '—',
    },
    {
      cle: 'classeTherapeutique',
      entete: 'Classe thérapeutique',
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
    <div className="space-y-10">
      {erreur && (
        <Alerte ton="erreur" className="p-3">
          {erreur}
        </Alerte>
      )}

      {nbArchives > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={voirArchives} onChange={(e) => setVoirArchives(e.target.checked)} />
          Archivés (retirés : {nbArchives})
        </label>
      )}

      {/* --- Actes --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Actes ({actes.length})
        </h2>
        <DataTable
          donnees={actesVisibles}
          cleLigne={(a) => a.id}
          parPage={10}
          recherche={{ placeholder: 'Libellé, code…', champs: ['libelle', 'code'] }}
          colonnes={colActes}
          actions={
            peutProposer ? (
              <FormulaireModal
                titre="Créer un acte directement"
                description="Le médecin conseil devra ensuite l'homologuer (statut PROPOSE)."
                declencheurLabel="Créer un acte"
                libelleSoumettre="Créer"
                onSoumettre={async (fd) => {
                  setErreur(null);
                  const r = await proposerActe({
                    code: String(fd.get('code') ?? ''),
                    libelle: String(fd.get('libelle') ?? ''),
                    categorie: String(fd.get('categorie') ?? '') || undefined,
                  });
                  return r.ok
                    ? { ok: true, message: r.message }
                    : { ok: false, error: r.error };
                }}
                onSucces={() => router.refresh()}
              >
                <ChampTexte name="code" label="Code" required maxLength={40} />
                <ChampTexte
                  name="libelle"
                  label="Libellé"
                  required
                  maxLength={300}
                />
                <ChampSelect
                  name="categorie"
                  label="Catégorie"
                  placeholder="Choisir…"
                  options={optionsCategories()}
                />
              </FormulaireModal>
            ) : undefined
          }
          actionLigne={
            peutProposer
              ? (a) => (
                  <span className="flex justify-end gap-2">
                    {a.statut === 'RETIRE' && (
                      <ConfirmationAction
                        action="desarchiver"
                        element={`l’acte « ${a.code} — ${a.libelle} »`}
                        consequence="Il repasse à l'état proposé : le médecin conseil devra l'homologuer de nouveau."
                        verifier={() => verifierAction('referentielActe', a.id, 'desarchiver')}
                        onConfirmer={() => reproposerActe(a.id)}
                        onSucces={() => router.refresh()}
                        declencheur={<Button type="button" size="xs" variant="ghost">Désarchiver</Button>}
                      />
                    )}
                    {a.statut === 'PROPOSE' && (
                      <ConfirmationAction
                        action="supprimer"
                        element={`l’acte « ${a.code} — ${a.libelle} »`}
                        consequence="Le code redevient disponible."
                        verifier={() => verifierAction('referentielActe', a.id, 'supprimer')}
                        onConfirmer={() => supprimerActe(a.id)}
                        onSucces={() => router.refresh()}
                        declencheur={
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            title={verdictsActes[a.id]?.supprimer && !verdictsActes[a.id].supprimer.possible ? (verdictsActes[a.id].supprimer.raison ?? undefined) : undefined}
                          >
                            Supprimer
                          </Button>
                        }
                      />
                    )}
                  </span>
                )
              : undefined
          }
          vide="Aucun acte dans le référentiel."
        />
      </section>

      {/* --- Médicaments --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Médicaments ({medicaments.length})
        </h2>
        <DataTable
          donnees={medicamentsVisibles}
          cleLigne={(m) => m.id}
          parPage={10}
          recherche={{
            placeholder: 'DCI, classe thérapeutique…',
            champs: ['denominationCommune', 'classeTherapeutique'],
          }}
          colonnes={colMedicaments}
          actions={
            peutProposer ? (
              <FormulaireModal
                titre="Créer un médicament directement"
                description="Le pharmacien conseil devra ensuite l'homologuer (statut PROPOSE)."
                declencheurLabel="Créer un médicament"
                libelleSoumettre="Créer"
                onSoumettre={async (fd) => {
                  setErreur(null);
                  const r = await proposerMedicament({
                    denominationCommune: String(
                      fd.get('denominationCommune') ?? '',
                    ),
                    nomCommercial:
                      String(fd.get('nomCommercial') ?? '') || undefined,
                    forme: String(fd.get('forme') ?? '') || undefined,
                    dosage: String(fd.get('dosage') ?? '') || undefined,
                    classeTherapeutique:
                      String(fd.get('classeTherapeutique') ?? '') || undefined,
                  });
                  return r.ok
                    ? { ok: true, message: r.message }
                    : { ok: false, error: r.error };
                }}
                onSucces={() => router.refresh()}
              >
                <ChampTexte
                  name="denominationCommune"
                  label="Dénomination commune (DCI)"
                  required
                  maxLength={200}
                />
                <ChampTexte
                  name="nomCommercial"
                  label="Nom commercial"
                  maxLength={200}
                />
                <ChampTexte name="forme" label="Forme" maxLength={120} />
                <ChampTexte name="dosage" label="Dosage" maxLength={80} />
                <ChampTexte
                  name="classeTherapeutique"
                  label="Classe thérapeutique"
                  maxLength={200}
                />
              </FormulaireModal>
            ) : undefined
          }
          actionLigne={
            peutProposer
              ? (m) => (
                  <span className="flex justify-end gap-2">
                    {m.statutHomologation === 'RETIRE' && (
                      <ConfirmationAction
                        action="desarchiver"
                        element={`le médicament « ${m.denominationCommune} »`}
                        consequence="Il repasse à l'état proposé : le pharmacien conseil devra l'homologuer de nouveau."
                        verifier={() => verifierAction('medicament', m.id, 'desarchiver')}
                        onConfirmer={() => reproposerMedicament(m.id)}
                        onSucces={() => router.refresh()}
                        declencheur={<Button type="button" size="xs" variant="ghost">Désarchiver</Button>}
                      />
                    )}
                    {m.statutHomologation === 'PROPOSE' && (
                      <ConfirmationAction
                        action="supprimer"
                        element={`le médicament « ${m.denominationCommune} »`}
                        verifier={() => verifierAction('medicament', m.id, 'supprimer')}
                        onConfirmer={() => supprimerMedicament(m.id)}
                        onSucces={() => router.refresh()}
                        declencheur={
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            title={verdictsMedicaments[m.id]?.supprimer && !verdictsMedicaments[m.id].supprimer.possible ? (verdictsMedicaments[m.id].supprimer.raison ?? undefined) : undefined}
                          >
                            Supprimer
                          </Button>
                        }
                      />
                    )}
                  </span>
                )
              : undefined
          }
          vide="Aucun médicament dans le référentiel."
        />
      </section>
    </div>
  );
}
