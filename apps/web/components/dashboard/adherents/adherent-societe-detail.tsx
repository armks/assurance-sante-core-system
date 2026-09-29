import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { StatutBadge } from '@/components/dashboard/patterns';
import { PageTitre } from '@/components/page-titre';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { chargerPhotosFamille, sansCheminsPhoto } from '@/lib/photos';
import {
  LIBELLE_STATUT_MEMBRE,
  TON_STATUT_MEMBRE,
  peutGererMembres,
  peutValiderBeneficiaireSociete,
} from '@/lib/member';
import { AdherentDetail } from './adherent-detail';
import type { AdherentDetail as AdherentDetailType } from './types';

/**
 * Détail d'un adhérent, filière société — factorisé (mêmes remarques que
 * `AdherentsSociete`). L'API scope déjà la lecture à SON souscripteur pour
 * tout rôle SOCIETE_AFFILIEE (404 sinon) ; `peutGerer` retire les actions
 * d'écriture pour les rôles en lecture seule.
 */
export async function AdherentSocieteDetail({
  id,
  basePath,
}: {
  id: string;
  basePath: string;
}) {
  const etat = await exigerIdentite(`${basePath}/${id}`);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch(`/api/v1/member/adherents/${id}`);
  if (res.status === 404) notFound();
  const adherent = (await res.json()) as AdherentDetailType;
  // Lecture seule côté société : médaillons, pas d'upload (réservé à
  // l'adhérent et au personnel INFORMATIQUE/EXPLOITATION).
  const photos = await chargerPhotosFamille(adherent);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={basePath}>
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
        adherent={sansCheminsPhoto(adherent)}
        peutGerer={peutGererMembres(etat.identity.permissions.roleChain)}
        peutValiderBeneficiaireSociete={peutValiderBeneficiaireSociete(etat.identity.permissions.roleChain)}
        photoAdherentUrl={photos.adherent}
        photosParBeneficiaire={photos.beneficiaires}
      />
    </div>
  );
}
