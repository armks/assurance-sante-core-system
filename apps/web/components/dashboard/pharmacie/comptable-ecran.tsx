'use client';

import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import type { CodeOrdonnancePharmacie } from '@/app/dashboard-pharmacie/types';

const LIBELLE_STATUT: Record<string, string> = {
  PRESENTE_PHARMACIE: 'En attente de dispensation',
  UTILISE_PARTIEL: 'Dispensée partiellement',
  UTILISE_COMPLET: 'Dispensée entièrement',
  EXPIRE: 'Expirée',
  ANNULE: 'Annulée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  PRESENTE_PHARMACIE: 'attention',
  UTILISE_PARTIEL: 'attention',
  UTILISE_COMPLET: 'succes',
  EXPIRE: 'danger',
  ANNULE: 'danger',
};

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');

export function ComptableEcran({ codes }: { codes: CodeOrdonnancePharmacie[] }) {
  const dispenseesCompletes = codes.filter((c) => c.statut === 'UTILISE_COMPLET');
  const enCours = codes.filter((c) =>
    ['PRESENTE_PHARMACIE', 'UTILISE_PARTIEL'].includes(c.statut),
  );
  const nombreLignes = codes.reduce((s, c) => s + (c.ordonnance?.lignes.length ?? 0), 0);

  const colonnes: ColonneTable<CodeOrdonnancePharmacie>[] = [
    {
      cle: 'numeroTraitement',
      entete: 'Dossier',
      rendu: (c) => c.ordonnance?.numeroTraitement ?? '—',
    },
    {
      cle: 'nombreLignes',
      entete: 'Nb. médicaments',
      aligneDroite: true,
      valeur: (c) => c.ordonnance?.lignes.length ?? 0,
      rendu: (c) => c.ordonnance?.lignes.length ?? 0,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'dateEmission',
      entete: 'Prise en charge le',
      triable: true,
      valeur: (c) => c.dateEmission,
      rendu: (c) => dateHeureFr(c.dateEmission),
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Suivi des dispensations de votre pharmacie. Aucun module de facturation ou de
        règlement des dispensations n’existe aujourd’hui dans l’application — cette vue
        est en lecture seule (l’API n’autorise pas d’écriture spécifique à ce rôle sur ces
        données).
      </p>
      <GrilleCartes>
        <CarteResume libelle="Dispensées entièrement" valeur={dispenseesCompletes.length} />
        <CarteResume libelle="En cours" valeur={enCours.length} />
        <CarteResume libelle="Lignes de médicaments (total)" valeur={nombreLignes} />
      </GrilleCartes>
      <DataTable
        donnees={codes}
        cleLigne={(c) => c.id}
        parPage={15}
        colonnes={colonnes}
        vide="Aucune dispensation pour l’instant dans votre pharmacie."
      />
    </div>
  );
}
