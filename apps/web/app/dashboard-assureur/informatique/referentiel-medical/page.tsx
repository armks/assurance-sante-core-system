import type { Metadata } from 'next';

import {
  ReferentielMedicalEcran,
  type ActeReferentiel,
  type MedicamentReferentiel,
} from '@/components/dashboard/referentiel-medical-ecran';
import { PageTitre } from '@/components/page-titre';
import { verdictsListe } from '@/app/dependances-actions';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = {
  title: 'Référentiel médical — Assurance Informatique',
};

/** Droit exclusif côté API — reference.types.ts, ROLE_PROPOSITION. */
const ROLE_PROPOSITION = 'ASSUREUR_INFORMATIQUE';

export default async function ReferentielMedical() {
  const [etat, resActes, resMedicaments] = await Promise.all([
    exigerIdentite('/dashboard-assureur/informatique/referentiel-medical'),
    apiFetch('/api/v1/reference/actes'),
    apiFetch('/api/v1/reference/medicaments'),
  ]);
  const actes: ActeReferentiel[] = resActes.ok ? await resActes.json() : [];
  const medicaments: MedicamentReferentiel[] = resMedicaments.ok
    ? await resMedicaments.json()
    : [];
  const erreur = resActes.ok
    ? resMedicaments.ok
      ? null
      : await messageErreur(resMedicaments)
    : await messageErreur(resActes);
  const roleChain = etat.kind === 'ok' ? etat.identity.permissions?.roleChain ?? [] : [];
  const peutProposer = roleChain.includes(ROLE_PROPOSITION);
  const [verdictsActes, verdictsMedicaments] = peutProposer
    ? await Promise.all([
        verdictsListe('referentielActe', actes.map((a) => a.id)),
        verdictsListe('medicament', medicaments.map((m) => m.id)),
      ])
    : [{}, {}];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Référentiel médical"
        description="Actes et médicaments proposés directement par l’Assurance Informatique — l’homologation reste réservée au médecin conseil / pharmacien conseil."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ReferentielMedicalEcran
          actes={actes}
          medicaments={medicaments}
          peutProposer={peutProposer}
          verdictsActes={verdictsActes}
          verdictsMedicaments={verdictsMedicaments}
        />
      )}
    </div>
  );
}
