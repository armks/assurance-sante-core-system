'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  proposerActe,
  proposerMedicament,
} from '@/app/dashboard-assureur/reference-actions';
import {
  Alerte,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { LIBELLE_STATUT_HOMOLOGATION } from '@/lib/referentiel';

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
}: {
  actes: ActeReferentiel[];
  medicaments: MedicamentReferentiel[];
  /** `true` uniquement si ASSUREUR_INFORMATIQUE figure dans la chaîne de
   * rôles — droit exclusif côté API (ROLE_PROPOSITION). */
  peutProposer: boolean;
}) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);

  const colActes: ColonneTable<ActeReferentiel>[] = [
    { cle: 'libelle', entete: 'Libellé', triable: true },
    { cle: 'code', entete: 'Code' },
    { cle: 'categorie', entete: 'Catégorie', rendu: (a) => a.categorie ?? '—' },
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

      {/* --- Actes --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Actes ({actes.length})
        </h2>
        <DataTable
          donnees={actes}
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
                <ChampTexte name="categorie" label="Catégorie" maxLength={120} />
              </FormulaireModal>
            ) : undefined
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
          donnees={medicaments}
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
          vide="Aucun médicament dans le référentiel."
        />
      </section>
    </div>
  );
}
