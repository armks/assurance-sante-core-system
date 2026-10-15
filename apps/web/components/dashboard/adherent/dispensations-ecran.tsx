'use client';

import type { DispensationResume, RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import type { PageServeur } from '@/components/dashboard/patterns';
import { DispensationsListeEcran } from '@/components/dashboard/pharmacie/dispensations-liste-ecran';

/** Dispensation vue par l'adhérent : même forme que l'historique de la pharmacie (+ pharmacie et code de confirmation). */
export type DispensationAdherent = DispensationResume;

/**
 * « Mes dispensations » : le MÊME tableau que l'historique de la pharmacie (coût, part assurance, part assuré, statut,
 * dates, détail des médicaments en popup au clic, cumul en tête), avec en plus la pharmacie et le code de confirmation
 * à valider tant que la pharmacie attend l'adhérent.
 */
export function DispensationsEcran({
  dispensations,
  recap = null,
  periode = 'jour',
  cartesFamille = [],
}: {
  /** Page renvoyée par l'API (pagination, statut et période côté serveur). */
  dispensations: PageServeur<DispensationAdherent>;
  recap?: RecapDispensations | null;
  periode?: string;
  cartesFamille?: { numeroCarte: string; nom: string }[];
}) {
  return (
    <DispensationsListeEcran
      adherent
      dispensations={dispensations}
      recap={recap}
      periode={periode}
      cartesFamille={cartesFamille}
      vide="Aucune dispensation ne correspond à ces critères."
    />
  );
}
