import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  MedecinConseilFacturesEtablissementEcran,
  type FactureMensuelleEtablissementAVerifier,
} from '@/components/dashboard/medecin-conseil-factures-etablissement-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Factures établissements — Médecin Conseil' };

interface FactureResume {
  id: string;
  etablissement: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateSoumission: string;
}

export default async function FacturesEtablissementAVerifierPage() {
  const etat = await exigerIdentite('/dashboard-assureur/medecin-conseil');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/preauthorization/factures-mensuelles-etablissement/a-verifier');
  const resumes: FactureResume[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  // Détail (lignes incluses) chargé en une fois pour chaque facture en attente
  // — la file est naturellement petite (une soumission par établissement et par mois).
  const factures: FactureMensuelleEtablissementAVerifier[] = await Promise.all(
    resumes.map(async (r) => {
      const resDetail = await apiFetch(`/api/v1/preauthorization/factures-mensuelles-etablissement/${r.id}`);
      const lignes = resDetail.ok ? (await resDetail.json()).lignes : [];
      return { ...r, lignes };
    }),
  );

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Factures établissements"
        description="Vérification globale de fin de mois, indépendante des validations individuelles faites par l'exploitation — double vérification anti-litige avant transmission au comptable."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <MedecinConseilFacturesEtablissementEcran factures={factures} />
      )}
    </div>
  );
}
