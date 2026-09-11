import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  ConsultationEcran,
  type CodeConsultation,
  type EtablissementOption,
} from '@/components/dashboard/adherent/consultation-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Consultation — Adhérent' };

interface AdherentPoliceOnly {
  police: { id: string } | null;
}

export default async function ConsultationPage() {
  const etat = await exigerIdentite('/dashboard-adherent/consultation');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const adherentId = etat.identity.permissions.scope.adherentId;
  if (!adherentId) {
    return (
      <div className="space-y-8">
        <PageTitre titre="Consultation" />
        <p className="text-sm text-destructive">
          Votre compte n’est rattaché à aucun adhérent — contactez votre assureur.
        </p>
      </div>
    );
  }

  const [resEtabs, resAdherent, resCodes] = await Promise.all([
    apiFetch('/api/v1/provider/etablissements?statut=ACTIF'),
    apiFetch(`/api/v1/member/adherents/${adherentId}`),
    apiFetch('/api/v1/preauthorization/codes-consultation'),
  ]);

  const etablissements: EtablissementOption[] = resEtabs.ok ? await resEtabs.json() : [];
  const erreur = resEtabs.ok ? null : await messageErreur(resEtabs);
  const adherent: AdherentPoliceOnly | null = resAdherent.ok ? await resAdherent.json() : null;
  const codes: CodeConsultation[] = resCodes.ok ? await resCodes.json() : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Demander une consultation"
        description="Sélectionnez l’établissement, obtenez un code à transmettre oralement à l’accueil."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ConsultationEcran
          etablissements={etablissements}
          policeId={adherent?.police?.id ?? null}
          codes={codes}
        />
      )}
    </div>
  );
}
