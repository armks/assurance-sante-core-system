import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  DossierDetail,
  type DossierComplet,
} from '@/components/dashboard/centre-medical/dossier-detail';
import { PageTitre } from '@/components/page-titre';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { ACTE_CONSULTATION_PAR_TYPE_VISITE, LIBELLE_STATUT_DOSSIER } from '@/lib/dossier-soins';

export const metadata: Metadata = { title: 'Dossier de soins — Parcours de soins' };

export default async function DossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const etat = await exigerIdentite(`/dashboard-centre-medical/medecin/${id}`);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [res, resMedecins] = await Promise.all([
    apiFetch(`/api/v1/care-episode/dossiers/${id}`),
    // médecins de l'établissement (403 attendu pour un rôle hors centre médical : liste vide)
    apiFetch('/api/v1/care-episode/dossiers/medecins'),
  ]);
  if (res.status === 404) notFound();
  const dossier = (await res.json()) as DossierComplet;
  const medecins: { id: string; libelle: string }[] = resMedecins.ok ? await resMedecins.json() : [];

  // Coût d'une consultation selon la convention de l'établissement (tarif de l'acte de consultation du type de visite) ;
  // indisponible (type de visite non défini, pas de convention, rôle sans droit) → pas de montant affiché.
  const acteConsultation = dossier.typeVisite ? ACTE_CONSULTATION_PAR_TYPE_VISITE[dossier.typeVisite] : undefined;
  let tarifConsultation: number | null = null;
  // répartition du tarif de consultation entre l'assurance et l'assuré (même calcul que pour les actes)
  let partsConsultation: { assurance: number; assure: number } | null = null;
  if (acteConsultation) {
    const resTarif = await apiFetch(
      `/api/v1/preauthorization/actes/tarif-reference?dossierId=${id}&codeActe=${acteConsultation.codeActe}&categorieActe=${acteConsultation.categorieActe}`,
    );
    if (resTarif.ok) {
      const t = (await resTarif.json()) as { tarifUnitaire: number | null; partAssurance?: number | null; partAssure?: number | null };
      tarifConsultation = t.tarifUnitaire;
      if (t.tarifUnitaire !== null && t.partAssurance != null && t.partAssure != null) partsConsultation = { assurance: t.partAssurance, assure: t.partAssure };
    }
  }

  const { profil, permissions } = etat.identity;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/dashboard-centre-medical/medecin">
          <ArrowLeft className="size-4" />
          Dossiers de soins
        </Link>
      </Button>

      <PageTitre
        titre={dossier.numeroTraitement}
        action={
          <StatutBadge
            statut={dossier.statut}
            libelles={LIBELLE_STATUT_DOSSIER}
          />
        }
      />

      <DossierDetail
        dossier={dossier}
        moiId={profil.id}
        role={profil.role ?? ''}
        roleChain={permissions.roleChain}
        medecins={medecins}
        tarifConsultation={tarifConsultation}
        partsConsultation={partsConsultation}
      />
    </div>
  );
}
