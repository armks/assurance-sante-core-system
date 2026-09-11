'use client';

import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';

export interface MedicamentReference {
  id: string;
  denominationCommune: string;
  nomCommercial: string | null;
  dosage: string | null;
  classeTherapeutique: string | null;
  remboursable: boolean;
  tauxRemboursementStd: string | number | null;
  prixMaxRemboursable: string | number | null;
  medicamentEssentiel: boolean;
  statutHomologation: string;
}

const montant = (v: string | number | null) =>
  v === null ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const pourcent = (v: string | number | null) => (v === null ? '—' : `${Number(v)} %`);

export function MedicamentsEcran({ medicaments }: { medicaments: MedicamentReference[] }) {
  const colonnes: ColonneTable<MedicamentReference>[] = [
    {
      cle: 'denominationCommune',
      entete: 'Dénomination',
      triable: true,
      rendu: (m) => (
        <div>
          <p className="font-medium">{m.denominationCommune}</p>
          {m.nomCommercial && (
            <p className="text-xs text-muted-foreground">{m.nomCommercial}</p>
          )}
        </div>
      ),
    },
    { cle: 'dosage', entete: 'Dosage', rendu: (m) => m.dosage ?? '—' },
    {
      cle: 'remboursable',
      entete: 'Remboursable',
      rendu: (m) =>
        m.remboursable ? (
          <StatutBadge statut="oui" ton="succes" libelle="Oui" />
        ) : (
          <StatutBadge statut="non" ton="neutre" libelle="Non" />
        ),
    },
    {
      cle: 'tauxRemboursementStd',
      entete: 'Taux standard',
      aligneDroite: true,
      valeur: (m) => Number(m.tauxRemboursementStd ?? 0),
      rendu: (m) => pourcent(m.tauxRemboursementStd),
    },
    {
      cle: 'prixMaxRemboursable',
      entete: 'Prix max. remboursable',
      aligneDroite: true,
      valeur: (m) => Number(m.prixMaxRemboursable ?? 0),
      rendu: (m) => montant(m.prixMaxRemboursable),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Référentiel national des médicaments homologués — lecture seule. Il ne s’agit pas
        d’un stock de pharmacie (aucune gestion de quantités disponibles n’existe
        aujourd’hui dans l’application).
      </p>
      <DataTable
        donnees={medicaments}
        cleLigne={(m) => m.id}
        parPage={15}
        recherche={{
          placeholder: 'Dénomination, nom commercial…',
          champs: ['denominationCommune', 'nomCommercial'],
        }}
        filtres={[
          {
            cle: 'remboursable',
            libelle: 'Remboursable',
            options: [
              { valeur: 'oui', libelle: 'Oui' },
              { valeur: 'non', libelle: 'Non' },
            ],
            valeur: (m) => ((m as MedicamentReference).remboursable ? 'oui' : 'non'),
          },
        ]}
        colonnes={colonnes}
        vide="Aucun médicament homologué pour l’instant."
      />
    </div>
  );
}
