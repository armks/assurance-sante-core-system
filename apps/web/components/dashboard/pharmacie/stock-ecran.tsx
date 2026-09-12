'use client';

import { useRouter } from 'next/navigation';

import { definirPrixStock } from '@/app/dashboard-pharmacie/dispensation-actions';
import type { LigneStock } from '@/app/dashboard-pharmacie/dispensation-types';
import {
  ChampCheckbox,
  ChampNombre,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';

const montantFr = (v: string | null) => (v === null ? '—' : `${Number(v).toLocaleString('fr-FR')} F`);

/**
 * Gestion du stock (`stock_medicaments_pharmacie`) — réservée au pharmacien
 * côté API (`assertPharmacien`) : un appel par la caissière/comptable
 * échoue en 403, quel que soit ce que montre l'UI. Seul le prix/la
 * disponibilité sont gérés ici ; la dénomination sert de clé (upsert).
 */
export function StockEcran({ stock, cible }: { stock: LigneStock[]; cible: string }) {
  const router = useRouter();

  const colonnes: ColonneTable<LigneStock>[] = [
    { cle: 'denominationMedicament', entete: 'Médicament', triable: true },
    {
      cle: 'prixPharmacie',
      entete: 'Prix',
      aligneDroite: true,
      valeur: (s) => (s.prixPharmacie === null ? -1 : Number(s.prixPharmacie)),
      rendu: (s) => montantFr(s.prixPharmacie),
    },
    {
      cle: 'disponible',
      entete: 'Disponibilité',
      rendu: (s) =>
        s.prixPharmacie === null ? (
          <StatutBadge statut="PRIX_NON_DEFINI" ton="attention" libelle="Prix non défini" />
        ) : s.disponible ? (
          <StatutBadge statut="DISPONIBLE" ton="succes" libelle="Disponible" />
        ) : (
          <StatutBadge statut="INDISPONIBLE" ton="danger" libelle="Indisponible" />
        ),
    },
  ];

  return (
    <DataTable
      donnees={stock}
      cleLigne={(s) => s.id}
      parPage={15}
      recherche={{ placeholder: 'Rechercher un médicament…', champs: ['denominationMedicament'] }}
      colonnes={colonnes}
      actions={
        <FormulaireModal
          titre="Définir un tarif"
          description="Créé une nouvelle ligne de stock si le médicament n'y figure pas encore, sinon met à jour son tarif."
          declencheurLabel="Ajouter / mettre à jour un tarif"
          libelleSoumettre="Enregistrer"
          onSoumettre={async (fd) => {
            const denomination = String(fd.get('denominationMedicament') ?? '');
            const prixValeur = fd.get('prixPharmacie');
            const prixPharmacie =
              prixValeur === null || prixValeur === '' ? undefined : Number(prixValeur);
            const disponible = fd.get('disponible') === 'on';
            return definirPrixStock(
              { denominationMedicament: denomination, prixPharmacie, disponible },
              cible,
            );
          }}
          onSucces={() => router.refresh()}
        >
          <ChampTexte
            name="denominationMedicament"
            label="Médicament (dénomination exacte)"
            required
            placeholder="Ex. Paracetamol 500mg"
          />
          <ChampNombre name="prixPharmacie" label="Prix de vente (F)" min={0} step="0.01" />
          <ChampCheckbox name="disponible" label="Disponible en stock" defaultChecked />
        </FormulaireModal>
      }
      actionLigne={(s) => (
        <FormulaireModal
          titre={`Modifier le tarif — ${s.denominationMedicament}`}
          mode="center"
          declencheurLabel="Modifier"
          libelleSoumettre="Enregistrer"
          onSoumettre={async (fd) => {
            const prixValeur = fd.get('prixPharmacie');
            const prixPharmacie =
              prixValeur === null || prixValeur === '' ? undefined : Number(prixValeur);
            const disponible = fd.get('disponible') === 'on';
            return definirPrixStock(
              { denominationMedicament: s.denominationMedicament, prixPharmacie, disponible },
              cible,
            );
          }}
          onSucces={() => router.refresh()}
        >
          <ChampNombre
            name="prixPharmacie"
            label="Prix de vente (F)"
            min={0}
            step="0.01"
            defaultValue={s.prixPharmacie ?? undefined}
          />
          <ChampCheckbox name="disponible" label="Disponible en stock" defaultChecked={s.disponible} />
        </FormulaireModal>
      )}
      vide="Aucun tarif défini pour l’instant — ajoutez votre premier médicament."
    />
  );
}
