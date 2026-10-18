import type { Metadata } from 'next';
import Link from 'next/link';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { PageTitre } from '@/components/page-titre';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import type { RendezVous } from '@/lib/rendez-vous';

export const metadata: Metadata = { title: 'Secrétaire assurance — Vue d’ensemble' };

export default async function SecretairePage() {
  const res = await apiFetch('/api/v1/rendez-vous');
  const rdv: RendezVous[] = res.ok ? await res.json() : [];
  const maintenant = new Date();
  return (
    <div className="space-y-6">
      <PageTitre titre="Secrétariat de l’assurance" description="Proposez des rendez-vous aux établissements pour les patients. Les adhérents vous écrivent par la messagerie (bulle en bas à droite) pour demander un rendez-vous." />
      <GrilleCartes>
        <CarteResume libelle="Propositions en attente" valeur={rdv.filter((r) => r.statut === 'PROPOSE').length} href="/dashboard-assureur/secretaire/rendez-vous" />
        <CarteResume libelle="Rendez-vous confirmés à venir" valeur={rdv.filter((r) => r.statut === 'CONFIRME' && new Date(r.dateFin) > maintenant).length} href="/dashboard-assureur/secretaire/rendez-vous" />
        <CarteResume libelle="Refusés" valeur={rdv.filter((r) => r.statut === 'REFUSE').length} href="/dashboard-assureur/secretaire/rendez-vous" />
      </GrilleCartes>
      <Button asChild>
        <Link href="/dashboard-assureur/secretaire/rendez-vous">Gérer les rendez-vous</Link>
      </Button>
    </div>
  );
}
