'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  approvisionnerCompte,
  archiverCompteFinancier,
  creerCompteFinancier,
  desarchiverCompteFinancier,
  modifierCompteFinancier,
  supprimerCompteFinancier,
} from '@/app/dashboard-assureur/comptable/comptes-financiers/actions';
import { verifierAction } from '@/app/dependances-actions';
import {
  Alerte,
  ConfirmationAction,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { dateFr, montantF } from '@/lib/format';

export interface CompteFinancier {
  id: string;
  type: string;
  nom: string;
  banqueNom: string | null;
  numeroCompte: string | null;
  soldeActuel: string;
  statut?: string;
  creePar: string | null;
  createdAt: string;
  updatedAt: string;
}

const LIBELLE_TYPE: Record<string, string> = {
  BANCAIRE: 'Compte bancaire',
  CAISSE_INTERNE: 'Caisse interne',
};

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
      description={`Solde actuel : ${montantF(compte.soldeActuel)}.`}
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
            .map((c) => ({ valeur: c.id, libelle: `${c.nom} (${montantF(c.soldeActuel)})` }))}
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

export function ComptesFinanciersEcran({
  comptes,
  mode = 'comptable',
}: {
  comptes: CompteFinancier[];
  /** `informatique` : cycle de vie seulement (libellé, archivage, suppression) — l'argent reste au comptable. */
  mode?: 'comptable' | 'informatique';
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [avecArchives, setAvecArchives] = useState(false);
  const visibles = avecArchives ? comptes : comptes.filter((c) => c.statut !== 'ARCHIVE');

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
      rendu: (c) => <span className="font-medium tabular-nums">{montantF(c.soldeActuel)}</span>,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) =>
        c.statut === 'ARCHIVE' ? (
          <StatutBadge statut="ARCHIVE" ton="neutre" libelles={{ ARCHIVE: 'Archivé' }} />
        ) : (
          <StatutBadge statut="ACTIF" ton="succes" libelles={{ ACTIF: 'Actif' }} />
        ),
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
      {message && <Alerte ton="succes">{message}</Alerte>}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={avecArchives}
          onChange={(e) => setAvecArchives(e.target.checked)}
        />
        Archivés ({comptes.filter((c) => c.statut === 'ARCHIVE').length})
      </label>
      <DataTable
        donnees={visibles}
        cleLigne={(c) => c.id}
        parPage={12}
        recherche={{ placeholder: 'Nom, banque…', champs: ['nom', 'banqueNom'] }}
        colonnes={colonnes}
        actions={
          mode === 'informatique' ? undefined : (
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
          )
        }
        actionLigne={(c) => (
          <span className="inline-flex items-center gap-1">
            {mode === 'comptable' && c.statut !== 'ARCHIVE' && (
              <ApprovisionnerForm compte={c} autresComptes={comptes.filter((x) => x.statut !== 'ARCHIVE')} onSucces={succes} />
            )}
            {c.statut !== 'ARCHIVE' && (
              <FormulaireModal
                titre={`Modifier le libellé — ${c.nom}`}
                mode="center"
                description={`Le solde (${montantF(c.soldeActuel)}) ne se modifie jamais directement : il ne bouge que par mouvement.`}
                declencheur={<Button size="xs" variant="ghost">Modifier</Button>}
                libelleSoumettre="Enregistrer"
                onSoumettre={async (fd) => modifierCompteFinancier(c.id, String(fd.get('nom') ?? ''))}
                onSucces={() => succes('Libellé modifié.')}
              >
                <ChampTexte name="nom" label="Libellé du compte" required defaultValue={c.nom} />
              </FormulaireModal>
            )}
            {c.statut === 'ARCHIVE' ? (
              <ConfirmationAction
                action="desarchiver"
                element={`le compte « ${c.nom} »`}
                verifier={() => verifierAction('compteFinancier', c.id, 'desarchiver')}
                onConfirmer={() => desarchiverCompteFinancier(c.id)}
                onSucces={() => succes('Compte désarchivé.')}
              />
            ) : (
              <ConfirmationAction
                action="archiver"
                element={`le compte « ${c.nom} »`}
                consequence="Il ne recevra ni ne servira plus aucun mouvement ; son historique reste consultable."
                verifier={() => verifierAction('compteFinancier', c.id, 'archiver')}
                onConfirmer={() => archiverCompteFinancier(c.id)}
                onSucces={() => succes('Compte archivé.')}
              />
            )}
            <ConfirmationAction
              action="supprimer"
              element={`le compte « ${c.nom} »`}
              consequence="Possible seulement s’il n’a aucun mouvement."
              verifier={() => verifierAction('compteFinancier', c.id, 'supprimer')}
              onConfirmer={() => supprimerCompteFinancier(c.id)}
              onSucces={() => succes('Compte supprimé.')}
            />
          </span>
        )}
        vide="Aucun compte financier pour l’instant."
      />
    </div>
  );
}
