import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DispensationEcran } from '@/components/dashboard/pharmacie/dispensation-ecran';
import type { CodeOrdonnancePharmacie } from '@/app/dashboard-pharmacie/types';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Vue d’ensemble — Pharmacien' };

const CIBLE = '/dashboard-pharmacie/pharmacien';

export default async function PharmacienPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const pharmacieId = etat.identity.permissions.scope.pharmacieId as string;

  const res = await apiFetch('/api/v1/preauthorization/codes-ordonnance/pharmacie');
  const codes: CodeOrdonnancePharmacie[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Ordonnances prises en charge par votre pharmacie et validation de nouveaux codes."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DispensationEcran pharmacieId={pharmacieId} codes={codes} cible={CIBLE} />
      )}
    </div>
  );
}
