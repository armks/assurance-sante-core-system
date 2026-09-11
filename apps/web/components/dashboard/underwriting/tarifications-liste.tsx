'use client';

import {
  DataTable,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { LIBELLE_DECISION, TON_DECISION } from '@/lib/underwriting';

export interface TarificationLigne {
  id: string;
  ageASubscription: number;
  primeBase: string;
  surprimeMedicale: string;
  primeFinale: string | null;
  createdAt: string;
  police: { numeroPolice: string; souscripteur: { nom: string } | null } | null;
  questionnaire: { decision: string | null } | null;
}

const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

export function TarificationsListe({
  tarifications,
}: {
  tarifications: TarificationLigne[];
}) {
  const colonnes: ColonneTable<TarificationLigne>[] = [
    {
      cle: 'police',
      entete: 'Police',
      triable: true,
      valeur: (t) => t.police?.numeroPolice ?? '',
      rendu: (t) => t.police?.numeroPolice ?? '—',
    },
    {
      cle: 'souscripteur',
      entete: 'Souscripteur',
      valeur: (t) => t.police?.souscripteur?.nom ?? '',
      rendu: (t) => t.police?.souscripteur?.nom ?? '—',
    },
    {
      cle: 'age',
      entete: 'Âge',
      aligneDroite: true,
      valeur: (t) => t.ageASubscription,
      rendu: (t) => `${t.ageASubscription} ans`,
    },
    {
      cle: 'decision',
      entete: 'Décision',
      rendu: (t) =>
        t.questionnaire?.decision ? (
          <StatutBadge
            statut={t.questionnaire.decision}
            map={TON_DECISION}
            libelles={LIBELLE_DECISION}
          />
        ) : (
          '—'
        ),
    },
    {
      cle: 'primeBase',
      entete: 'Prime de base',
      aligneDroite: true,
      valeur: (t) => Number(t.primeBase),
      rendu: (t) => montant(t.primeBase),
    },
    {
      cle: 'surprimeMedicale',
      entete: 'Surprime médicale',
      aligneDroite: true,
      valeur: (t) => Number(t.surprimeMedicale),
      rendu: (t) => montant(t.surprimeMedicale),
    },
    {
      cle: 'primeFinale',
      entete: 'Prime finale',
      aligneDroite: true,
      valeur: (t) => Number(t.primeFinale ?? 0),
      rendu: (t) => (
        <span className="font-medium">{montant(t.primeFinale)}</span>
      ),
    },
    {
      cle: 'createdAt',
      entete: 'Calculée le',
      triable: true,
      valeur: (t) => t.createdAt,
      rendu: (t) => dateFr(t.createdAt),
    },
  ];

  return (
    <DataTable
      donnees={tarifications}
      cleLigne={(t) => t.id}
      parPage={15}
      recherche={{ placeholder: 'Police, souscripteur…', champs: ['police.numeroPolice', 'police.souscripteur.nom'] }}
      colonnes={colonnes}
      vide="Aucune tarification individuelle calculée pour l’instant."
    />
  );
}
