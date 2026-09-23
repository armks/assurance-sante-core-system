'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  enregistrerDepense,
  obtenirUrlPieceJointeMouvement,
  transfererEntreComptes,
} from '@/app/dashboard-assureur/comptable/mouvements-financiers/actions';
import type { CompteFinancier } from '@/components/dashboard/comptes-financiers-ecran';
import {
  ChampFichier,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface MouvementFinancier {
  id: string;
  type: 'TRANSFERT' | 'DEPENSE' | 'APPROVISIONNEMENT' | 'PAIEMENT_FACTURE';
  montant: string;
  description: string;
  aUnePieceJointe: boolean;
  compteSource: { id: string; nom: string } | null;
  compteDestination: { id: string; nom: string } | null;
  effectuePar: string;
  createdAt: string;
}

const LIBELLE_TYPE: Record<string, string> = {
  TRANSFERT: 'Transfert',
  DEPENSE: 'Dépense',
  APPROVISIONNEMENT: 'Approvisionnement',
  PAIEMENT_FACTURE: 'Paiement de facture',
};
const TON_TYPE: Record<string, 'succes' | 'attention' | 'danger' | 'neutre' | 'info'> = {
  TRANSFERT: 'info',
  DEPENSE: 'attention',
  APPROVISIONNEMENT: 'succes',
  PAIEMENT_FACTURE: 'neutre',
};

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');

function Selecteur({
  libelle,
  valeur,
  options,
  onChange,
}: {
  libelle: string;
  valeur: string;
  options: { valeur: string; libelle: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      aria-label={libelle}
    >
      <option value="">{libelle} : tous</option>
      {options.map((o) => (
        <option key={o.valeur} value={o.valeur}>
          {o.libelle}
        </option>
      ))}
    </select>
  );
}

function FormulaireTransfert({ comptes, onSucces }: { comptes: CompteFinancier[]; onSucces: (m: string) => void }) {
  const options = comptes.map((c) => ({ valeur: c.id, libelle: `${c.nom} (${montant(c.soldeActuel)})` }));
  return (
    <FormulaireModal
      titre="Nouveau transfert entre comptes"
      declencheurLabel="Nouveau transfert"
      libelleSoumettre="Transférer"
      onSoumettre={async (fd) => transfererEntreComptes(fd)}
      onSucces={() => onSucces('Transfert effectué.')}
    >
      <ChampSelect name="compteSourceId" label="Compte source (débité)" required placeholder="Choisir…" options={options} />
      <ChampSelect
        name="compteDestinationId"
        label="Compte destination (crédité)"
        required
        placeholder="Choisir…"
        options={options}
      />
      <ChampNombre name="montant" label="Montant (F)" required min={0.01} step="0.01" />
      <ChampTexte name="description" label="Description" placeholder="Virement mensuel vers la caisse interne" />
      <ChampFichier
        name="pieceJointe"
        label="Pièce jointe (chèque, reçu…)"
        accept="application/pdf,image/jpeg,image/png"
        aide="PDF, JPEG ou PNG — 10 Mo maximum, facultatif."
      />
    </FormulaireModal>
  );
}

function FormulaireDepense({ comptes, onSucces }: { comptes: CompteFinancier[]; onSucces: (m: string) => void }) {
  const options = comptes.map((c) => ({ valeur: c.id, libelle: `${c.nom} (${montant(c.soldeActuel)})` }));
  return (
    <FormulaireModal
      titre="Enregistrer une dépense"
      declencheurLabel="Nouvelle dépense"
      libelleSoumettre="Enregistrer"
      onSoumettre={async (fd) => enregistrerDepense(fd)}
      onSucces={() => onSucces('Dépense enregistrée.')}
    >
      <ChampSelect name="compteId" label="Compte à débiter" required placeholder="Choisir…" options={options} />
      <ChampNombre name="montant" label="Montant (F)" required min={0.01} step="0.01" />
      <ChampTexte name="description" label="Description" required minLength={3} placeholder="Fournitures de bureau" />
      <ChampFichier
        name="pieceJointe"
        label="Pièce jointe (reçu, facture…)"
        accept="application/pdf,image/jpeg,image/png"
        aide="PDF, JPEG ou PNG — 10 Mo maximum, facultatif."
      />
    </FormulaireModal>
  );
}

export function MouvementsFinanciersEcran({
  mouvements,
  comptes,
}: {
  mouvements: MouvementFinancier[];
  comptes: CompteFinancier[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [filtreCompteId, setFiltreCompteId] = useState('');
  const [filtreType, setFiltreType] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [montantMin, setMontantMin] = useState('');
  const [montantMax, setMontantMax] = useState('');

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  async function voirPiece(mouvementId: string) {
    const res = await obtenirUrlPieceJointeMouvement(mouvementId);
    if (res?.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    else setMessage("Impossible d'ouvrir la pièce jointe.");
  }

  const concerneCompte = (m: MouvementFinancier, compteId: string) =>
    m.compteSource?.id === compteId || m.compteDestination?.id === compteId;

  const mouvementsFiltres = useMemo(() => {
    return mouvements.filter((m) => {
      if (filtreCompteId && !concerneCompte(m, filtreCompteId)) return false;
      if (filtreType && m.type !== filtreType) return false;
      if (dateDebut && new Date(m.createdAt) < new Date(dateDebut)) return false;
      if (dateFin && new Date(m.createdAt) > new Date(`${dateFin}T23:59:59`)) return false;
      if (montantMin && Number(m.montant) < Number(montantMin)) return false;
      if (montantMax && Number(m.montant) > Number(montantMax)) return false;
      return true;
    });
  }, [mouvements, filtreCompteId, filtreType, dateDebut, dateFin, montantMin, montantMax]);

  /**
   * Solde après chaque mouvement, pour LE compte sélectionné uniquement (une
   * moyenne/liste multi-comptes n'a pas de solde courant unique). Reconstruit
   * en partant du solde ACTUEL (ancre) et en « défaisant » chaque mouvement du
   * plus récent au plus ancien — `mouvements` est déjà trié desc par date.
   */
  const soldeApres = useMemo(() => {
    if (!filtreCompteId) return new Map<string, string>();
    const compte = comptes.find((c) => c.id === filtreCompteId);
    if (!compte) return new Map<string, string>();

    const concernes = mouvements.filter((m) => concerneCompte(m, filtreCompteId));
    const resultat = new Map<string, string>();
    let solde = Number(compte.soldeActuel);
    for (const m of concernes) {
      resultat.set(m.id, solde.toFixed(2));
      const delta = m.compteDestination?.id === filtreCompteId ? Number(m.montant) : -Number(m.montant);
      solde -= delta;
    }
    return resultat;
  }, [mouvements, comptes, filtreCompteId]);

  const optTypes = [...new Set(mouvements.map((m) => m.type))];

  const colonnes: ColonneTable<MouvementFinancier>[] = [
    {
      cle: 'createdAt',
      entete: 'Date',
      triable: true,
      valeur: (m) => m.createdAt,
      rendu: (m) => dateHeureFr(m.createdAt),
    },
    {
      cle: 'type',
      entete: 'Type',
      rendu: (m) => <StatutBadge statut={m.type} map={TON_TYPE} libelles={LIBELLE_TYPE} />,
    },
    { cle: 'compteSource', entete: 'Compte source', rendu: (m) => m.compteSource?.nom ?? '—' },
    { cle: 'compteDestination', entete: 'Compte destination', rendu: (m) => m.compteDestination?.nom ?? '—' },
    {
      cle: 'montant',
      entete: 'Montant',
      aligneDroite: true,
      triable: true,
      valeur: (m) => Number(m.montant),
      rendu: (m) => <span className="font-medium tabular-nums">{montant(m.montant)}</span>,
    },
    { cle: 'description', entete: 'Description', rendu: (m) => <span className="text-xs">{m.description}</span> },
    ...(filtreCompteId
      ? [
          {
            cle: 'soldeApres',
            entete: 'Solde après',
            aligneDroite: true,
            rendu: (m: MouvementFinancier) =>
              soldeApres.has(m.id) ? (
                <span className="tabular-nums text-muted-foreground">{montant(soldeApres.get(m.id)!)}</span>
              ) : (
                '—'
              ),
          } as ColonneTable<MouvementFinancier>,
        ]
      : []),
    { cle: 'effectuePar', entete: 'Par', rendu: (m) => <span className="text-xs">{m.effectuePar}</span> },
  ];

  return (
    <div className="space-y-8">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <FormulaireTransfert comptes={comptes} onSucces={succes} />
        <FormulaireDepense comptes={comptes} onSucces={succes} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Selecteur
            libelle="Compte"
            valeur={filtreCompteId}
            onChange={setFiltreCompteId}
            options={comptes.map((c) => ({ valeur: c.id, libelle: c.nom }))}
          />
          <Selecteur
            libelle="Type"
            valeur={filtreType}
            onChange={setFiltreType}
            options={optTypes.map((t) => ({ valeur: t, libelle: LIBELLE_TYPE[t] ?? t }))}
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Du
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Au
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
          <input
            type="number"
            placeholder="Montant min"
            className="h-9 w-32 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
            value={montantMin}
            onChange={(e) => setMontantMin(e.target.value)}
          />
          <input
            type="number"
            placeholder="Montant max"
            className="h-9 w-32 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
            value={montantMax}
            onChange={(e) => setMontantMax(e.target.value)}
          />
        </CardContent>
      </Card>

      <DataTable
        donnees={mouvementsFiltres}
        cleLigne={(m) => m.id}
        parPage={15}
        colonnes={colonnes}
        actionLigne={(m) =>
          m.aUnePieceJointe ? (
            <Button size="xs" variant="ghost" onClick={() => voirPiece(m.id)}>
              Voir la pièce
            </Button>
          ) : null
        }
        vide="Aucun mouvement pour l’instant."
      />
    </div>
  );
}
