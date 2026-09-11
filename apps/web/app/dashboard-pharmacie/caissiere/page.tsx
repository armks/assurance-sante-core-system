import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DispensationEcran } from '@/components/dashboard/pharmacie/dispensation-ecran';
import type { CodeOrdonnancePharmacie } from '@/app/dashboard-pharmacie/types';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Vue d’ensemble — Caissière' };

const CIBLE = '/dashboard-pharmacie/caissiere';

/**
 * Écran identique à celui du pharmacien : `ROLES_PHARMACIE` (côté API) ne
 * distingue pas PHARMACIE_CAISSIERE de PHARMACIE_PHARMACIEN sur la validation
 * de code ni sur la dispensation — vérifié explicitement avant de construire
 * cet écran (voir PROGRESSION.md). Seule la page « Médicaments remboursables »
 * n'est pas proposée ici (hors périmètre demandé pour ce rôle).
 */
export default async function CaissierePage() {
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
