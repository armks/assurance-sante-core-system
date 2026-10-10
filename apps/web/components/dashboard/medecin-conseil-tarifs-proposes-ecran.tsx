'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ajusterTarifPropose,
  envoyerRappelsTarifs,
  refuserTarifPropose,
  validerTarifPropose,
} from '@/app/dashboard-assureur/tarifs-proposes-actions';
import {
  Alerte,
  ChampSelect,
  ChampTexte,
  ChampZone,
  ConfirmationAction,
  DataTable,
  FiltresServeur,
  FormulaireModal,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { useCategoriesActe } from '@/components/categories-acte';
import { Button } from '@/components/ui/button';
import { dateFr, montantF as montant } from '@/lib/format';
import { LIBELLE_STATUT_TARIF_A_EXAMINER as LIBELLE_STATUT, TON_STATUT_TARIF_PROPOSE as TON_STATUT } from '@/lib/tarifs';

export interface TarifAExaminer {
  id: string;
  etablissement: string | null;
  categorieActe: string | null;
  acte: { libelle: string; codeActe: string | null; quantite: number; prixAffiche: string | null } | null;
  montantPropose: string;
  montantRetenu: string | null;
  justification: string;
  statut: string;
  motifDecision: string | null;
  dateProposition: string;
  alerteRenforcee: boolean;
  alerteRecurrence: boolean;
  alerteDetails: {
    raison?: string;
    mediane?: string;
    nbReference?: number;
    seuilPourcent?: number;
    ecartPourcent?: string | null;
    recurrence?: { nombre: number };
  } | null;
  alertePlafond?: boolean;
  ancienneteJours: number;
  enRetard: boolean;
  peutDecider: boolean;
}

function texteAlerte(t: TarifAExaminer): string {
  const d = t.alerteDetails;
  if (!t.alerteRenforcee || !d) return '';
  return d.raison === 'SANS_HISTORIQUE'
    ? 'Aucun historique de tarifs reconnus pour cette catégorie sur 12 mois : alerte systématique.'
    : `Montant par unité supérieur de ${d.ecartPourcent ?? '?'} % à la médiane des tarifs reconnus (${d.mediane} F sur ${d.nbReference} lignes, seuil ${d.seuilPourcent} %).`;
}

/** Choix « ajouter à la convention » après une validation ou un ajustement. */
const OPTIONS_AJOUT = [
  { valeur: '', libelle: 'Ne pas ajouter à la convention' },
  { valeur: 'FORFAIT', libelle: 'Ajouter un forfait (par unité) à la convention' },
  { valeur: 'VALEUR_LETTRE_CLE', libelle: 'Ajouter une valeur de lettre-clé propre à l’acte' },
];

export function MedecinConseilTarifsProposesEcran({
  page,
  etablissements,
  peutDecider,
}: {
  page: PageServeur<TarifAExaminer>;
  etablissements: { id: string; nom: string }[];
  peutDecider: boolean;
}) {
  const router = useRouter();
  const { libelle: libelleCategorie, options: optionsCategories } = useCategoriesActe();
  const [message, setMessage] = useState<string | null>(null);
  const [alertePlafond, setAlertePlafond] = useState<string | null>(null);

  function apres(r: { alerte?: string }, msg: string) {
    setMessage(msg);
    setAlertePlafond(r.alerte ?? null);
    router.refresh();
  }

  const colonnes: ColonneTable<TarifAExaminer>[] = [
    {
      cle: 'alerte',
      entete: 'Alertes',
      rendu: (t) => (
        <span className="flex flex-col gap-1 text-xs" data-testid="alertes-tarif">
          {t.alerteRenforcee && (
            <span className="font-semibold text-amber-700 dark:text-amber-400" title={texteAlerte(t)}>
              Alerte renforcée
            </span>
          )}
          {t.alerteRecurrence && <span className="text-amber-700 dark:text-amber-400">Récurrence ({t.alerteDetails?.recurrence?.nombre ?? '5+'} en 30 j)</span>}
          {t.enRetard && <span className="text-destructive">En retard</span>}
          {!t.alerteRenforcee && !t.alerteRecurrence && !t.enRetard && '—'}
        </span>
      ),
    },
    {
      cle: 'etablissement',
      entete: 'Établissement',
      rendu: (t) => (
        <span>
          {t.etablissement ?? '—'}
          <span className="block text-xs text-muted-foreground">{t.categorieActe ? libelleCategorie(t.categorieActe) : ''}</span>
        </span>
      ),
    },
    {
      cle: 'acte',
      entete: 'Acte',
      rendu: (t) => (
        <span>
          <span className="font-medium">{t.acte?.libelle ?? '—'}</span>
          <span className="block text-xs text-muted-foreground">
            {t.acte?.codeActe ?? 'sans code'} · quantité {t.acte?.quantite ?? 1}
          </span>
        </span>
      ),
    },
    { cle: 'prix', entete: 'Prix affiché', aligneDroite: true, rendu: (t) => montant(t.acte?.prixAffiche ?? null) },
    { cle: 'montant', entete: 'Montant proposé', aligneDroite: true, rendu: (t) => montant(t.montantPropose) },
    {
      cle: 'justification',
      entete: 'Justification',
      rendu: (t) => (
        <span className="text-xs">
          {t.justification}
          {texteAlerte(t) && <span className="mt-1 block text-amber-700 dark:text-amber-400">{texteAlerte(t)}</span>}
        </span>
      ),
    },
    {
      cle: 'anciennete',
      entete: 'Ancienneté',
      aligneDroite: true,
      rendu: (t) => (
        <span>
          {t.ancienneteJours} j<span className="block text-xs text-muted-foreground">{dateFr(t.dateProposition)}</span>
        </span>
      ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (t) => (
        <span>
          <StatutBadge statut={t.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
          {t.motifDecision && <span className="mt-1 block text-xs text-muted-foreground">{t.motifDecision}</span>}
          {t.montantRetenu && <span className="mt-1 block text-xs">Retenu : {montant(t.montantRetenu)}</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400" role="status">
          {message}
        </p>
      )}
      {alertePlafond && (
        <Alerte ton="avertissement" titre="Plafond déjà atteint">
          {alertePlafond}
        </Alerte>
      )}
      <FiltresServeur
        selects={[
          { cle: 'statut', libelle: 'Statut', options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })) },
          { cle: 'etablissementId', libelle: 'Établissement', options: etablissements.map((e) => ({ valeur: e.id, libelle: e.nom })) },
          {
            cle: 'ancienneteMin',
            libelle: 'Ancienneté',
            options: [
              { valeur: '2', libelle: '2 jours et plus' },
              { valeur: '5', libelle: '5 jours et plus' },
              { valeur: '10', libelle: '10 jours et plus' },
            ],
          },
          {
            cle: 'categorie',
            libelle: 'Catégorie',
            options: optionsCategories(),
          },
        ]}
      />
      <DataTable
        donnees={page.items}
        cleLigne={(t) => t.id}
        parPage={0}
        piedMasque
        colonnes={colonnes}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const r = await envoyerRappelsTarifs();
              setMessage(r.ok ? `Rappels envoyés : ${r.rappels} · escalades à la direction : ${r.escalades}.` : r.error);
            }}
          >
            Envoyer les rappels
          </Button>
        }
        actionLigne={(t) =>
          peutDecider && t.peutDecider ? (
            <span className="flex flex-wrap justify-end gap-1">
              <ConfirmationAction
                action="valider"
                element={`le tarif proposé de ${montant(t.montantPropose)} pour « ${t.acte?.libelle ?? 'cet acte'} »`}
                consequence="Le calcul est repris avec ce montant sous le verrou de la personne ; la ligne est réintégrée à la facture mensuelle et la part du patient est facturée à part."
                onConfirmer={async () => {
                  const r = await validerTarifPropose(t.id);
                  if (r.ok) apres(r, 'Tarif validé.');
                  return r;
                }}
                declencheur={<Button size="xs">Valider</Button>}
              />
              <FormulaireModal
                titre="Valider et ajouter à la convention"
                description={`Valide ${montant(t.montantPropose)} pour « ${t.acte?.libelle ?? 'cet acte'} » et crée une exception d’acte dans une NOUVELLE version de la convention (proposée, à valider par le circuit normal — jamais en modifiant la convention validée).`}
                declencheur={<Button size="xs" variant="outline">Valider + convention</Button>}
                libelleSoumettre="Valider et proposer à la convention"
                onSoumettre={async (fd) => {
                  const type = String(fd.get('ajout') ?? '') as '' | 'FORFAIT' | 'VALEUR_LETTRE_CLE';
                  const r = await validerTarifPropose(t.id, type || undefined);
                  return r.ok ? { ok: true, message: 'Tarif validé.' } : { ok: false, error: r.error };
                }}
                onSucces={() => apres({}, 'Tarif validé ; exception ajoutée à une nouvelle version de convention à valider.')}
              >
                <ChampSelect name="ajout" label="Exception à créer" required defaultValue="FORFAIT" options={OPTIONS_AJOUT.slice(1)} />
              </FormulaireModal>
              <FormulaireModal
                titre="Ajuster le tarif proposé"
                description={`Montant proposé : ${montant(t.montantPropose)}. Indiquez le montant retenu et le motif de l’ajustement.`}
                declencheur={<Button size="xs" variant="outline">Ajuster</Button>}
                libelleSoumettre="Enregistrer l’ajustement"
                onSoumettre={async (fd) => {
                  const ajout = String(fd.get('ajout') ?? '') as '' | 'FORFAIT' | 'VALEUR_LETTRE_CLE';
                  const r = await ajusterTarifPropose(
                    t.id,
                    Number(String(fd.get('montantDecide') ?? '0').replace(',', '.')),
                    String(fd.get('motif') ?? ''),
                    ajout || undefined,
                  );
                  return r.ok ? { ok: true, message: 'Tarif ajusté.' } : { ok: false, error: r.error };
                }}
                onSucces={() => apres({}, 'Tarif ajusté.')}
              >
                <ChampTexte name="montantDecide" label="Montant retenu (FCFA, total)" type="number" required />
                <ChampZone name="motif" label="Motif de l’ajustement" required minLength={5} maxLength={1000} rows={3} />
                <ChampSelect name="ajout" label="Ajouter à la convention" defaultValue="" options={OPTIONS_AJOUT} />
              </FormulaireModal>
              <ConfirmationAction
                action="refuser"
                element={`le tarif proposé de ${montant(t.montantPropose)} pour « ${t.acte?.libelle ?? 'cet acte'} »`}
                consequence="L’acte reste non tarifable ; l’établissement est prévenu avec votre motif ; le patient reçoit une facture complémentaire du prix affiché."
                motif={{ libelle: 'Motif du refus', minimum: 5 }}
                onConfirmer={async (motif) => {
                  const r = await refuserTarifPropose(t.id, motif ?? '');
                  if (r.ok) apres(r, 'Tarif refusé : l’établissement est prévenu.');
                  return r;
                }}
                declencheur={<Button size="xs" variant="ghost">Refuser</Button>}
              />
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t.statut === 'PROPOSE' ? 'Lecture seule' : ''}</span>
          )
        }
        vide="Aucun tarif proposé ne correspond à ces critères."
      />
      <PaginationServeur page={page.page} pages={page.pages} total={page.total} limite={page.limite} />
    </div>
  );
}
