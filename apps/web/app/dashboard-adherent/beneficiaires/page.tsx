import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import type { AdherentDetail, Beneficiaire } from '@/components/dashboard/adherents/types';
import { BeneficiairesEcran } from '@/components/dashboard/adherent/beneficiaires-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { chargerPhotosFamille, sansCheminsPhoto } from '@/lib/photos';

export const metadata: Metadata = { title: 'Mes bénéficiaires — Adhérent' };

export default async function BeneficiairesPage() {
  const etat = await exigerIdentite('/dashboard-adherent/beneficiaires');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const adherentId = etat.identity.permissions.scope.adherentId;
  if (!adherentId) {
    return (
      <div className="space-y-8">
        <PageTitre titre="Mes bénéficiaires" />
        <p className="text-sm text-destructive">
          Votre compte n’est rattaché à aucun adhérent — contactez votre assureur.
        </p>
      </div>
    );
  }

  const res = await apiFetch(`/api/v1/member/adherents/${adherentId}`);
  const adherent: AdherentDetail | null = res.ok ? await res.json() : null;
  const erreur = res.ok ? null : await messageErreur(res);
  const beneficiaires: Beneficiaire[] = adherent?.beneficiaires ?? [];

  const photos = adherent
    ? await chargerPhotosFamille(adherent)
    : { adherent: null, beneficiaires: {} };

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mes bénéficiaires"
        description="Proposez l’ajout d’un ayant droit (conjoint, enfant…) — soumis à validation de votre société puis de l’assureur avant l’attribution de sa carte."
      />
      {erreur || !adherent ? (
        <p className="text-sm text-destructive">{erreur ?? 'Adhérent introuvable.'}</p>
      ) : (
        <BeneficiairesEcran
          adherentId={adherentId}
          beneficiaires={sansCheminsPhoto({ beneficiaires }).beneficiaires ?? []}
          photoAdherentUrl={photos.adherent}
          photosParBeneficiaire={photos.beneficiaires}
        />
      )}
    </div>
  );
}
