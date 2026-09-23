'use client';

import { payerFacture } from '@/app/dashboard-assureur/paiements-actions';
import type { CompteFinancier } from '@/components/dashboard/comptes-financiers-ecran';
import { ChampNombre, ChampSelect, ChampTexte, ChampZone, FormulaireModal } from '@/components/dashboard/patterns';

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

/**
 * Formulaire de paiement RÉEL partagé par les 3 écrans qui déclenchaient
 * autrefois un « marquer payé(e) » symbolique (factures établissement/
 * pharmacie individuelles, paiements groupés) — un seul point d'entrée
 * (`payerFacture`), cohérent avec le fait que le backend n'en expose qu'un.
 *
 * Si `paiementProgrammeDate` est déjà renseignée (statut PAIEMENT_PROGRAMME),
 * soumettre SANS choisir de nouvelle date confirme et exécute le débit réel
 * maintenant ; choisir une nouvelle date future reprogramme.
 */
export function PaiementFactureForm({
  factureMensuelleId,
  paiementGroupeId,
  montantRestant,
  paiementProgrammeDate,
  comptes,
  cible,
  onSucces,
}: {
  factureMensuelleId?: string;
  paiementGroupeId?: string;
  montantRestant: string;
  paiementProgrammeDate?: string | null;
  comptes: CompteFinancier[];
  cible: string;
  onSucces: (m: string) => void;
}) {
  const dejaProgramme = !!paiementProgrammeDate;

  return (
    <FormulaireModal
      titre={dejaProgramme ? 'Confirmer ou reprogrammer le paiement' : 'Payer'}
      mode="center"
      description={
        dejaProgramme
          ? `Paiement programmé pour le ${dateFr(paiementProgrammeDate!)}. Soumettre sans nouvelle date confirme et débite maintenant.`
          : `Montant restant dû : ${montant(montantRestant)}. Laissez le montant vide pour payer l'intégralité.`
      }
      declencheurLabel={dejaProgramme ? 'Confirmer' : 'Payer'}
      libelleSoumettre={dejaProgramme ? 'Confirmer / reprogrammer' : 'Payer'}
      onSoumettre={async (fd) => {
        const compteId = String(fd.get('compteId') ?? '');
        const montantSaisi = fd.get('montant');
        const montantValeur = montantSaisi === null || montantSaisi === '' ? undefined : Number(montantSaisi);
        const dateProgrammee = String(fd.get('dateProgrammee') ?? '') || undefined;
        const preuvePaiement = String(fd.get('preuvePaiement') ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        return payerFacture(
          { factureMensuelleId, paiementGroupeId, compteId, montant: montantValeur, dateProgrammee, preuvePaiement },
          cible,
        );
      }}
      onSucces={() => onSucces(dejaProgramme ? 'Paiement confirmé.' : 'Paiement traité.')}
    >
      <ChampSelect
        name="compteId"
        label="Compte à débiter"
        required
        placeholder="Choisir…"
        options={comptes.map((c) => ({ valeur: c.id, libelle: `${c.nom} (${montant(c.soldeActuel)})` }))}
      />
      <ChampNombre
        name="montant"
        label="Montant (F)"
        min={0.01}
        step="0.01"
        placeholder={montantRestant}
        disabled={!!paiementGroupeId}
        aide={
          paiementGroupeId
            ? 'Le paiement d’un groupe est toujours intégral.'
            : 'Laissez vide pour payer le solde restant dû.'
        }
      />
      <ChampTexte name="dateProgrammee" label="Programmer à une date future (facultatif)" type="date" />
      <ChampZone
        name="preuvePaiement"
        label="Références de paiement (facultatif)"
        aide="Une par ligne (numéro de virement, chèque…)."
      />
    </FormulaireModal>
  );
}
