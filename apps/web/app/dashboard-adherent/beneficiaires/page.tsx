import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { obtenirPhotoAdherent, obtenirPhotoBeneficiaire } from '@/app/dashboard-adherent/beneficiaires-actions';
import type { AdherentDetail, Beneficiaire } from '@/components/dashboard/adherents/types';
import { BeneficiairesEcran } from '@/components/dashboard/adherent/beneficiaires-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

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

  const [photoAdherent, photosBeneficiaires] = await Promise.all([
    adherent?.photoUrl ? obtenirPhotoAdherent(adherentId) : Promise.resolve(null),
    Promise.all(
      beneficiaires.map((b) => (b.photoUrl ? obtenirPhotoBeneficiaire(adherentId, b.id) : Promise.resolve(null))),
    ),
  ]);

  const photosParBeneficiaire = Object.fromEntries(
    beneficiaires.map((b, i) => {
      const r = photosBeneficiaires[i];
      return [b.id, r?.ok ? r.url : null];
    }),
  );

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
          beneficiaires={beneficiaires}
          photoAdherentUrl={photoAdherent?.ok ? photoAdherent.url : null}
          photosParBeneficiaire={photosParBeneficiaire}
        />
      )}
    </div>
  );
}
