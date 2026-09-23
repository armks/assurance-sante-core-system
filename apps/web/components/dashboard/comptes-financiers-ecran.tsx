'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  approvisionnerCompte,
  creerCompteFinancier,
} from '@/app/dashboard-assureur/comptable/comptes-financiers/actions';
import {
  ChampNombre,
  ChampSelect,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';

export interface CompteFinancier {
  id: string;
  type: string;
  nom: string;
  banqueNom: string | null;
  numeroCompte: string | null;
  soldeActuel: string;
  creePar: string | null;
  createdAt: string;
  updatedAt: string;
}

const LIBELLE_TYPE: Record<string, string> = {
  BANCAIRE: 'Compte bancaire',
  CAISSE_INTERNE: 'Caisse interne',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

function ApprovisionnerForm({
  compte,
  autresComptes,
  onSucces,
}: {
  compte: CompteFinancier;
  autresComptes: CompteFinancier[];
  onSucces: (m: string) => void;
}) {
  const [source, setSource] = useState<'EXTERNE' | 'AUTRE_COMPTE'>('EXTERNE');

  return (
    <FormulaireModal
      titre={`Approvisionner — ${compte.nom}`}
      mode="center"
      description={`Solde actuel : ${montant(compte.soldeActuel)}.`}
      declencheurLabel="Approvisionner"
      libelleSoumettre="Approvisionner"
      onSoumettre={async (fd) => {
        const montantSaisi = Number(fd.get('montant') ?? 0);
        const compteSourceId = source === 'AUTRE_COMPTE' ? String(fd.get('compteSourceId') ?? '') : undefined;
        const pieces = String(fd.get('piecesJustificatives') ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        return approvisionnerCompte(compte.id, montantSaisi, source, compteSourceId, pieces);
      }}
      onSucces={() => onSucces('Compte approvisionné.')}
    >
      <ChampNombre name="montant" label="Montant (F)" required min={0.01} step="0.01" />
      <ChampSelect
        name="source"
        label="Source"
        required
        value={source}
        onChange={(e) => setSource(e.target.value as 'EXTERNE' | 'AUTRE_COMPTE')}
        options={[
          { valeur: 'EXTERNE', libelle: 'Source externe (virement, dépôt…)' },
          { valeur: 'AUTRE_COMPTE', libelle: 'Un autre compte financier' },
        ]}
      />
      {source === 'AUTRE_COMPTE' && (
        <ChampSelect
          name="compteSourceId"
          label="Compte source (sera débité)"
          required
          placeholder="Choisir…"
          options={autresComptes
            .filter((c) => c.id !== compte.id)
            .map((c) => ({ valeur: c.id, libelle: `${c.nom} (${montant(c.soldeActuel)})` }))}
        />
      )}
      <ChampZone
        name="piecesJustificatives"
        label="Pièces justificatives"
        aide="Une référence par ligne (numéro de virement, reçu, bordereau…)."
      />
    </FormulaireModal>
  );
}

export function ComptesFinanciersEcran({ comptes }: { comptes: CompteFinancier[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  const colonnes: ColonneTable<CompteFinancier>[] = [
    { cle: 'nom', entete: 'Nom', triable: true },
    {
      cle: 'type',
      entete: 'Type',
      rendu: (c) => <StatutBadge statut={c.type} ton="info" libelles={LIBELLE_TYPE} />,
    },
    { cle: 'banqueNom', entete: 'Banque', rendu: (c) => c.banqueNom ?? '—' },
    { cle: 'numeroCompte', entete: 'N° compte', rendu: (c) => c.numeroCompte ?? '—' },
    {
      cle: 'soldeActuel',
      entete: 'Solde actuel',
      aligneDroite: true,
      triable: true,
      valeur: (c) => Number(c.soldeActuel),
      rendu: (c) => <span className="font-medium tabular-nums">{montant(c.soldeActuel)}</span>,
    },
    {
      cle: 'updatedAt',
      entete: 'Mis à jour le',
      triable: true,
      valeur: (c) => c.updatedAt,
      rendu: (c) => dateFr(c.updatedAt),
    },
  ];

  return (
    <div className="space-y-6">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}
      <DataTable
        donnees={comptes}
        cleLigne={(c) => c.id}
        parPage={12}
        recherche={{ placeholder: 'Nom, banque…', champs: ['nom', 'banqueNom'] }}
        colonnes={colonnes}
        actions={
          <FormulaireModal
            titre="Nouveau compte financier"
            declencheurLabel="Nouveau compte"
            libelleSoumettre="Créer le compte"
            onSoumettre={async (fd) => {
              const type = String(fd.get('type') ?? 'BANCAIRE') as 'BANCAIRE' | 'CAISSE_INTERNE';
              const nom = String(fd.get('nom') ?? '');
              const banqueNom = String(fd.get('banqueNom') ?? '') || undefined;
              const numeroCompte = String(fd.get('numeroCompte') ?? '') || undefined;
              const fondsInitial = Number(fd.get('fondsInitial') ?? 0);
              return creerCompteFinancier(type, nom, fondsInitial, banqueNom, numeroCompte);
            }}
            onSucces={() => succes('Compte créé.')}
          >
            <ChampSelect
              name="type"
              label="Type"
              required
              options={[
                { valeur: 'BANCAIRE', libelle: 'Compte bancaire' },
                { valeur: 'CAISSE_INTERNE', libelle: 'Caisse interne' },
              ]}
            />
            <ChampTexte name="nom" label="Nom du compte" required placeholder="Compte principal NSIA" />
            <ChampTexte name="banqueNom" label="Banque (si compte bancaire)" placeholder="NSIA Banque" />
            <ChampTexte name="numeroCompte" label="Numéro de compte" placeholder="CI001234567890" />
            <ChampNombre name="fondsInitial" label="Fonds initial (F)" required min={0} step="0.01" />
          </FormulaireModal>
        }
        actionLigne={(c) => <ApprovisionnerForm compte={c} autresComptes={comptes} onSucces={succes} />}
        vide="Aucun compte financier pour l’instant."
      />
    </div>
  );
}
