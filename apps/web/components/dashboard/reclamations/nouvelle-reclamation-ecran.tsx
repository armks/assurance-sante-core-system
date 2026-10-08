'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';

import { soumettreReclamation } from '@/app/dashboard-assureur/reclamations-actions';
import { useCategoriesActe } from '@/components/categories-acte';
import {
  ChampNombre,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Réponse de `GET /api/v1/claims/reclamations/actes-reclamables`. */
export interface ActeReclamable {
  id: string;
  libelle: string;
  categorieActe: string;
  codeActe: string | null;
  dateSoins: string;
  montant: string;
  dossierSoinsId: string;
  etablissement: string | null;
  patient: {
    type: 'ADHERENT' | 'BENEFICIAIRE';
    nom: string;
    prenom: string;
    numeroCarte: string | null;
  } | null;
}

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const montantFr = (v: string | number) => `${Number(v).toLocaleString('fr-FR')} F`;
const nomPatient = (a: ActeReclamable) =>
  a.patient ? `${a.patient.prenom} ${a.patient.nom}` : '—';

/**
 * Écran « Nouvelle réclamation » : choix d'un acte réclamable puis soumission. Après
 * soumission, ouvre le détail de la réclamation (décision du moteur d'adjudication,
 * montant remboursé, motifs).
 */
export function NouvelleReclamationEcran({
  actes,
  recherche,
}: {
  actes: ActeReclamable[];
  recherche: string;
}) {
  const router = useRouter();
  const { libelle: libelleCategorie } = useCategoriesActe();
  // identifiant de la réclamation créée, pour ouvrir son détail après succès
  const derniere = useRef<string | null>(null);

  const colonnes: ColonneTable<ActeReclamable>[] = [
    {
      cle: 'patient',
      entete: 'Patient',
      triable: true,
      valeur: (a) => nomPatient(a),
      rendu: (a) => (
        <span className="flex flex-col">
          <span className="font-medium">{nomPatient(a)}</span>
          <span className="text-xs text-muted-foreground">
            {a.patient?.type === 'BENEFICIAIRE' ? 'Bénéficiaire' : 'Adhérent'}
            {a.patient?.numeroCarte ? ` · ${a.patient.numeroCarte}` : ''}
          </span>
        </span>
      ),
    },
    {
      cle: 'acte',
      entete: 'Acte',
      valeur: (a) => `${a.libelle} ${libelleCategorie(a.categorieActe)}`,
      rendu: (a) => (
        <span className="flex flex-col">
          <span>{a.libelle}</span>
          <span className="text-xs text-muted-foreground">{libelleCategorie(a.categorieActe)}</span>
        </span>
      ),
    },
    {
      cle: 'dateSoins',
      entete: 'Date des soins',
      triable: true,
      valeur: (a) => a.dateSoins,
      rendu: (a) => dateFr(a.dateSoins),
    },
    { cle: 'etablissement', entete: 'Établissement', rendu: (a) => a.etablissement ?? '—' },
    {
      cle: 'montant',
      entete: 'Montant de l’acte',
      aligneDroite: true,
      valeur: (a) => Number(a.montant),
      rendu: (a) => montantFr(a.montant),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Recherche côté serveur (au-delà des actes affichés) */}
      <form method="get" className="flex max-w-md items-center gap-2" role="search">
        <Input
          name="recherche"
          defaultValue={recherche}
          placeholder="Nom, prénom ou n° de carte du patient"
          aria-label="Rechercher un patient"
        />
        <Button type="submit" size="sm" variant="outline">
          <Search className="size-4" />
          Rechercher
        </Button>
      </form>

      <DataTable
        donnees={actes}
        cleLigne={(a) => a.id}
        parPage={15}
        colonnes={colonnes}
        filtres={[
          {
            cle: 'type',
            libelle: 'Patient',
            valeur: (a) => (a as ActeReclamable).patient?.type ?? '',
            options: [
              { valeur: 'ADHERENT', libelle: 'Adhérent' },
              { valeur: 'BENEFICIAIRE', libelle: 'Bénéficiaire' },
            ],
          },
        ]}
        actionLigne={(a) => (
          <FormulaireModal
            titre="Soumettre la réclamation"
            description={`${a.libelle} — ${nomPatient(a)}, soins du ${dateFr(a.dateSoins)}. La décision (remboursement, revue manuelle ou rejet) est rendue immédiatement.`}
            mode="center"
            declencheur={
              <Button size="xs" variant="outline">
                Réclamer
              </Button>
            }
            libelleSoumettre="Soumettre"
            onSoumettre={async (fd) => {
              const v = fd.get('montant');
              const montant = v === null || v === '' ? undefined : Number(v);
              const r = await soumettreReclamation(a.id, montant);
              if (r.ok) derniere.current = r.reclamationId;
              return r;
            }}
            onSucces={() => {
              if (derniere.current) {
                router.push(`/dashboard-assureur/informatique/reclamations/${derniere.current}`);
              }
            }}
          >
            <div className="flex items-center gap-2 text-sm">
              <StatutBadge statut="REALISE" ton="succes" libelle="Acte réalisé" />
              <span className="text-muted-foreground">
                {libelleCategorie(a.categorieActe)} · {a.etablissement ?? 'établissement inconnu'}
              </span>
            </div>
            <ChampNombre
              name="montant"
              label="Montant payé par le patient (FCFA)"
              min={0}
              step="0.01"
              defaultValue={Number(a.montant)}
              aide="Par défaut, le montant de l’acte. Le remboursement est calculé sur ce montant (tarif conventionné, franchise, taux, plafonds)."
            />
          </FormulaireModal>
        )}
        vide={
          recherche
            ? `Aucun acte réclamable pour « ${recherche} ».`
            : 'Aucun acte réclamable : tous les actes réalisés sont déjà facturés en tiers payant ou réclamés.'
        }
      />
    </div>
  );
}
