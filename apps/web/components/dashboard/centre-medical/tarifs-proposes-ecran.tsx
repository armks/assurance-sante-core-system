'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { proposerTarif } from '@/app/dashboard-centre-medical/tarifs-proposes-actions';
import {
  Alerte,
  ChampSelect,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { dateFr, montantF as montant } from '@/lib/format';

export interface TarifProposeLigne {
  id: string;
  acteDossierId: string;
  montantPropose: string;
  justification: string;
  statut: string;
  dateProposition: string;
  montantDecide: string | null;
  motifDecision: string | null;
  acte: { libelle: string; codeActe: string | null; quantite: number; prixAffiche: string | null } | null;
}

export interface ActeAProposer {
  id: string;
  libelle: string;
  codeActe: string | null;
  quantite: number;
  prixAffiche: string | null;
  dateRealisation: string | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  PROPOSE: 'En cours d’examen',
  VALIDE: 'Validé',
  AJUSTE: 'Ajusté',
  REFUSE: 'Refusé',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  PROPOSE: 'attention',
  VALIDE: 'succes',
  AJUSTE: 'succes',
  REFUSE: 'danger',
};

/**
 * Tarifs proposés (ADR-008, lot 4) — l'établissement propose un montant TOTAL, avec justification, pour un acte que
 * la convention ne permet pas de tarifer. La décision (médecin conseil) arrive au lot 5.
 */
export function TarifsProposesEcran({
  propositions,
  actes,
  peutProposer,
}: {
  propositions: TarifProposeLigne[];
  actes: ActeAProposer[];
  peutProposer: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const colonnes: ColonneTable<TarifProposeLigne>[] = [
    {
      cle: 'acte',
      entete: 'Acte',
      valeur: (t) => t.acte?.libelle ?? '',
      rendu: (t) => (
        <span>
          <span className="font-medium">{t.acte?.libelle ?? '—'}</span>
          <span className="block text-xs text-muted-foreground">
            {t.acte?.codeActe ?? 'sans code'} · quantité {t.acte?.quantite ?? 1}
          </span>
        </span>
      ),
    },
    {
      cle: 'prixAffiche',
      entete: 'Prix affiché',
      aligneDroite: true,
      valeur: (t) => Number(t.acte?.prixAffiche ?? 0),
      rendu: (t) => montant(t.acte?.prixAffiche ?? null),
    },
    {
      cle: 'montantPropose',
      entete: 'Montant proposé',
      aligneDroite: true,
      valeur: (t) => Number(t.montantPropose),
      rendu: (t) => montant(t.montantPropose),
    },
    {
      cle: 'justification',
      entete: 'Justification',
      rendu: (t) => <span className="text-xs">{t.justification}</span>,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (t) => (
        <span>
          <StatutBadge statut={t.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
          {t.motifDecision && <span className="mt-1 block text-xs text-muted-foreground">{t.motifDecision}</span>}
          {t.montantDecide && <span className="mt-1 block text-xs">Montant retenu : {montant(t.montantDecide)}</span>}
        </span>
      ),
    },
    {
      cle: 'dateProposition',
      entete: 'Proposé le',
      valeur: (t) => t.dateProposition,
      rendu: (t) => dateFr(t.dateProposition),
    },
  ];

  return (
    <div className="space-y-4">
      <Alerte ton="info" titre="Quand proposer un tarif ?">
        Lorsque la facturation exclut un acte « non tarifable » (la convention ne donne ni forfait ni valeur de lettre-clé
        pour lui), proposez ici le montant TOTAL de l’acte avec une justification. L’acte est alors facturé à titre
        provisoire : le patient règle le reste, et la ligne est payable une fois le tarif validé.
      </Alerte>
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}
      <DataTable
        donnees={propositions}
        cleLigne={(t) => t.id}
        parPage={15}
        colonnes={colonnes}
        actions={
          peutProposer ? (
            <FormulaireModal
              titre="Proposer un tarif"
              description="Montant TOTAL de l’acte (quantité comprise) et justification obligatoire. Seul un acte réellement non tarifable peut recevoir une proposition."
              declencheurLabel="Proposer un tarif"
              libelleSoumettre="Envoyer la proposition"
              onSoumettre={async (fd) =>
                proposerTarif({
                  acteDossierId: String(fd.get('acteDossierId') ?? ''),
                  montantPropose: Number(String(fd.get('montantPropose') ?? '0').replace(',', '.')),
                  justification: String(fd.get('justification') ?? ''),
                })
              }
              onSucces={() => {
                setMessage('Tarif proposé : il sera examiné par le médecin conseil.');
                router.refresh();
              }}
            >
              <ChampSelect
                name="acteDossierId"
                label="Acte"
                required
                placeholder="Choisir un acte réalisé…"
                defaultValue=""
                options={actes.map((a) => ({
                  valeur: a.id,
                  libelle: `${a.libelle} (${a.codeActe ?? 'sans code'}) — qté ${a.quantite}${a.prixAffiche ? ` — ${montant(a.prixAffiche)}` : ''}`,
                }))}
              />
              <ChampTexte name="montantPropose" label="Montant proposé (FCFA, total)" type="number" required />
              <ChampZone
                name="justification"
                label="Justification"
                required
                minLength={10}
                maxLength={1000}
                rows={4}
                aide="Pourquoi ce montant ? (devis, tarif habituel, acte hors nomenclature…)"
              />
            </FormulaireModal>
          ) : undefined
        }
        vide="Aucune proposition de tarif."
      />
    </div>
  );
}
