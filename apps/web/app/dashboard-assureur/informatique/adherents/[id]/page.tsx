import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AdherentDetail } from '@/components/dashboard/adherents/adherent-detail';
import type { AdherentDetail as AdherentDetailType } from '@/components/dashboard/adherents/types';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { LIBELLE_STATUT_MEMBRE, TON_STATUT_MEMBRE } from '@/lib/member';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { chargerPhotosFamille, sansCheminsPhoto } from '@/lib/photos';
import {
  peutGererMembres,
  peutModifierPhotoMembre,
  peutValiderAdherent,
  peutValiderBeneficiaireAssureur,
  peutValiderBeneficiaireSociete,
} from '@/lib/member';

export const metadata: Metadata = { title: 'Adhérent — Assurance Informatique' };

export default async function AdherentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const etat = await exigerIdentite(
    `/dashboard-assureur/informatique/adherents/${id}`,
  );
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch(`/api/v1/member/adherents/${id}`);
  if (res.status === 404) notFound();
  const adherent = (await res.json()) as AdherentDetailType;

  // Photos affichées à tout lecteur de la fiche (URLs signées courte durée) ;
  // modifiables seulement par INFORMATIQUE/EXPLOITATION.
  const roleChain = etat.identity.permissions.roleChain;
  const peutModifierPhoto = peutModifierPhotoMembre(roleChain);
  const photos = await chargerPhotosFamille(adherent);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-assureur/informatique/adherents">
          <ArrowLeft className="size-4" />
          Adhérents
        </Link>
      </Button>

      <PageTitre
        titre={`${adherent.nom} ${adherent.prenom}`}
        action={
          <StatutBadge
            statut={adherent.statut}
            map={TON_STATUT_MEMBRE}
            libelles={LIBELLE_STATUT_MEMBRE}
          />
        }
      />

      <AdherentDetail
        retourHref="/dashboard-assureur/informatique/adherents"
        adherent={sansCheminsPhoto(adherent)}
        peutGerer={peutGererMembres(etat.identity.permissions.roleChain)}
        peutValider={peutValiderAdherent(etat.identity.permissions.roleChain)}
        peutValiderBeneficiaireSociete={peutValiderBeneficiaireSociete(etat.identity.permissions.roleChain)}
        peutValiderBeneficiaireAssureur={peutValiderBeneficiaireAssureur(etat.identity.permissions.roleChain)}
        peutModifierPhoto={peutModifierPhoto}
        photoAdherentUrl={photos.adherent}
        photosParBeneficiaire={photos.beneficiaires}
      />
    </div>
  );
}
