'use client';

import { useRouter } from 'next/navigation';

import { definirPrixStock } from '@/app/dashboard-pharmacie/dispensation-actions';
import type { LigneStock } from '@/app/dashboard-pharmacie/dispensation-types';
import {
  ChampCheckbox,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { ChampMedicamentBase } from './champ-medicament-base';

/**
 * Gestion du stock (`stock_medicaments_pharmacie`) — réservée au pharmacien
 * côté API (`assertPharmacien`) : un appel par la caissière/comptable
 * échoue en 403, quel que soit ce que montre l'UI. Seul le prix/la
 * disponibilité est gérée ici : le prix n'est plus porté par le stock, il est saisi au comptoir par le
 * caissier à partir du prix national unique (migration 078).
 */
export function StockEcran({ stock, cible }: { stock: LigneStock[]; cible: string }) {
  const router = useRouter();

  const colonnes: ColonneTable<LigneStock>[] = [
    { cle: 'denominationMedicament', entete: 'Médicament', triable: true },
    {
      cle: 'disponible',
      entete: 'Disponibilité',
      rendu: (s) =>
        s.disponible ? (
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
          titre="Signaler la disponibilité d’un médicament"
          description="Par défaut tout médicament est disponible ; signalez ici ceux qui ne le sont pas. Le prix se saisit au comptoir."
          declencheurLabel="Ajouter / mettre à jour"
          libelleSoumettre="Enregistrer"
          onSoumettre={async (fd) => {
            const medicamentId = String(fd.get('medicamentId') ?? '');
            if (!medicamentId) return { ok: false, error: 'Choisissez le médicament dans la liste de la base.' };
            const disponible = fd.get('disponible') === 'on';
            return definirPrixStock({ medicamentId, disponible }, cible);
          }}
          onSucces={() => router.refresh()}
        >
          <ChampMedicamentBase />
          <ChampCheckbox name="disponible" label="Disponible en stock" defaultChecked />
        </FormulaireModal>
      }
      actionLigne={(s) => (
        <FormulaireModal
          titre={`Disponibilité — ${s.denominationMedicament}`}
          mode="center"
          declencheurLabel="Modifier"
          libelleSoumettre="Enregistrer"
          onSoumettre={async (fd) => {
            const disponible = fd.get('disponible') === 'on';
            return definirPrixStock({ denominationMedicament: s.denominationMedicament, disponible }, cible);
          }}
          onSucces={() => router.refresh()}
        >
          <ChampCheckbox name="disponible" label="Disponible en stock" defaultChecked={s.disponible} />
        </FormulaireModal>
      )}
      vide="Aucun médicament signalé indisponible — tout est réputé disponible."
    />
  );
}
