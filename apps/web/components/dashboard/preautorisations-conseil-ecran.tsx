'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  BlocAccordeon,
  DecisionMedecinConseil,
  PropositionsGroupees,
  type ActeExploitation,
} from '@/components/dashboard/exploitation-preautorisations-ecran';

/**
 * Pré-autorisations du médecin conseil : mêmes principes que l'exploitation — une ligne par dossier (patient), dépliable sur les actes
 * escaladés, récapitulatif cumulé en tête ; le bouton « Décision » est celui du second niveau (approuver / refuser avec motif).
 */
export function PreautorisationsConseilEcran({ actes }: { actes: ActeExploitation[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}
      <BlocAccordeon titre="Actes à pré-autoriser" nombre={actes.length} ouvertParDefaut>
        <PropositionsGroupees
          actes={actes}
          etablissements={[]}
          racineDossier="/dashboard-assureur/medecin-conseil/dossiers"
          onSucces={setMessage}
          libelleActes="Actes en attente"
          vide="Aucun acte en attente de pré-autorisation."
          actionActe={(a) => (
            <DecisionMedecinConseil
              acte={{ ...a, numeroTraitement: a.numeroTraitement }}
              onSucces={() => {
                setMessage('Décision enregistrée.');
                router.refresh();
              }}
            />
          )}
        />
      </BlocAccordeon>
    </div>
  );
}
