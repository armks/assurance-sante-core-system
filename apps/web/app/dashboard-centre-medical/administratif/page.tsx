import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  AdministratifEcran,
  type EtablissementInfo,
} from '@/components/dashboard/centre-medical/administratif-ecran';
import type { DossierResume } from '@/components/dashboard/centre-medical/dossiers-ecran';
import { GraphiquesSoinsServeur } from '@/components/dashboard/exploitation/graphiques-soins-serveur';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Vue d’ensemble — Administratif' };

/**
 * Vue d'ensemble du rôle CENTRE_MEDICAL_ADMINISTRATIF. Ce rôle a un accès
 * MODIFICATION transverse (valider un code, ajouter consultation/acte/
 * ordonnance, clôturer, générer une facture — cf. `lib/centre-medical.ts`,
 * ROLES_GESTION_DOSSIER / ROLES_AJOUT_ACTE / ROLES_GENERATION_FACTURE) : ces
 * actions vivent déjà dans les écrans partagés /accueil, /medecin,
 * /comptable (accessibles via la nav commune aux 4 sous-rôles). Cette page
 * n'en duplique aucune — elle affiche uniquement ce que ce rôle peut
 * REELEMENT faire en propre : consulter (lecture seule, l'API ne lui accorde
 * pas l'écriture — ROLES_GESTION_RESEAU = ASSUREUR_INFORMATIQUE) les
 * informations de son établissement, et une vue d'ensemble des dossiers de
 * soins de cet établissement (désormais scopé côté API, cf. fix sécurité
 * care-episode).
 */
export default async function AdministratifPage() {
  const etat = await exigerIdentite('/dashboard-centre-medical/administratif');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const etablissementId = etat.identity.permissions.scope
    .etablissementId as string;

  const [resEtab, resDossiers] = await Promise.all([
    apiFetch(`/api/v1/provider/etablissements/${etablissementId}`),
    apiFetch(`/api/v1/care-episode/dossiers?etablissementId=${etablissementId}`),
  ]);

  const etablissement: EtablissementInfo | null = resEtab.ok
    ? await resEtab.json()
    : null;
  const erreur = resEtab.ok ? null : await messageErreur(resEtab);
  const dossiers: DossierResume[] = resDossiers.ok ? await resDossiers.json() : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble — Administratif"
        description="Votre établissement et le suivi des dossiers de soins en cours."
      />
      {erreur || !etablissement ? (
        <p className="text-sm text-destructive">
          {erreur ?? 'Établissement introuvable.'}
        </p>
      ) : (
        <>
          <GraphiquesSoinsServeur />
          <AdministratifEcran etablissement={etablissement} dossiers={dossiers} />
        </>
      )}
    </div>
  );
}
