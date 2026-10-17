import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import type { PlafondsFamille } from '@/components/dashboard/plafonds-famille';
import {
  AdherentVueEnsemble,
  type AdherentDetail,
  type ProduitAvecGaranties,
  type ReclamationAdherent,
} from '@/components/dashboard/adherent/vue-ensemble-ecran';
import { GraphiquesAdherent } from '@/components/dashboard/graphiques-roles';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { chargerPhotosFamille, sansCheminsPhoto } from '@/lib/photos';

export const metadata: Metadata = { title: 'Vue d’ensemble — Adhérent' };

export default async function AdherentAccueil() {
  const etat = await exigerIdentite('/dashboard-adherent');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const adherentId = etat.identity.permissions.scope.adherentId;
  if (!adherentId) {
    return (
      <div className="space-y-8">
        <PageTitre titre="Vue d’ensemble" />
        <p className="text-sm text-destructive">
          Votre compte n’est rattaché à aucun adhérent — contactez votre assureur.
        </p>
      </div>
    );
  }

  const [resAdherent, resReclamations] = await Promise.all([
    apiFetch(`/api/v1/member/adherents/${adherentId}`),
    apiFetch('/api/v1/claims/reclamations'),
  ]);

  const adherent: AdherentDetail | null = resAdherent.ok ? await resAdherent.json() : null;
  const erreur = resAdherent.ok ? null : await messageErreur(resAdherent);
  const reclamations: ReclamationAdherent[] = resReclamations.ok
    ? await resReclamations.json()
    : [];

  const produitId = adherent?.police?.produit?.id;
  const [resProduit, photos, resPlafonds] = await Promise.all([
    produitId ? apiFetch(`/api/v1/plan/produits/${produitId}`) : Promise.resolve(null),
    adherent ? chargerPhotosFamille(adherent) : Promise.resolve({ adherent: null, beneficiaires: {} }),
    adherent?.police ? apiFetch(`/api/v1/member/adherents/${adherentId}/plafonds`) : Promise.resolve(null),
  ]);
  const produit: ProduitAvecGaranties | null =
    resProduit && resProduit.ok ? await resProduit.json() : null;
  // Indisponibilité du suivi des plafonds : message dans sa carte, la page reste utilisable.
  const plafonds: PlafondsFamille | null =
    resPlafonds && resPlafonds.ok ? await resPlafonds.json() : null;
  const erreurPlafonds = resPlafonds && !resPlafonds.ok ? await messageErreur(resPlafonds) : null;

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Votre couverture, vos garanties et le suivi de vos réclamations."
      />
      {erreur || !adherent ? (
        <p className="text-sm text-destructive">{erreur ?? 'Adhérent introuvable.'}</p>
      ) : (
        <>
        <GraphiquesAdherent reclamations={reclamations} plafonds={plafonds} />
        <AdherentVueEnsemble
          adherent={sansCheminsPhoto(adherent)}
          produit={produit}
          reclamations={reclamations}
          photoAdherentUrl={photos.adherent}
          photosParBeneficiaire={photos.beneficiaires}
          plafonds={plafonds}
          erreurPlafonds={erreurPlafonds}
        />
        </>
      )}
    </div>
  );
}
