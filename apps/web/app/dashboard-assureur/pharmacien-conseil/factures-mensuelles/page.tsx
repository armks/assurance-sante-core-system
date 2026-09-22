import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  PharmacienConseilFacturesMensuellesEcran,
  type FactureMensuelleAValider,
} from '@/components/dashboard/pharmacien-conseil-factures-mensuelles-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Factures mensuelles — Pharmacien Conseil' };

interface FactureResume {
  id: string;
  pharmacie: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateSoumission: string;
}

export default async function FacturesMensuellesAValiderPage() {
  const etat = await exigerIdentite('/dashboard-assureur/pharmacien-conseil');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/pharmacy/factures-mensuelles/a-valider');
  const resumes: FactureResume[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  // Détail (lignes incluses) chargé en une fois pour chaque facture en attente
  // — la file est naturellement petite (une soumission par pharmacie et par mois).
  const factures: FactureMensuelleAValider[] = await Promise.all(
    resumes.map(async (r) => {
      const resDetail = await apiFetch(`/api/v1/pharmacy/factures-mensuelles/${r.id}`);
      const lignes = resDetail.ok ? (await resDetail.json()).lignes : [];
      return { ...r, lignes };
    }),
  );

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Factures mensuelles"
        description="Validation de la consolidation mensuelle des pharmacies — double vérification anti-litige avant déblocage pour le comptable."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <PharmacienConseilFacturesMensuellesEcran factures={factures} />
      )}
    </div>
  );
}
