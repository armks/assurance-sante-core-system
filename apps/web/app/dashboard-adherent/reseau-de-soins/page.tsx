import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import { depuisApi, parNom, type LieuAnnuaire } from '@/components/reseau-soins/lieu';
import { ReseauSoinsRecherche } from '@/components/reseau-soins/reseau-soins-recherche';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Réseau de soins — Adhérent' };

/**
 * Annuaire du réseau conventionné de l'organisation de l'adhérent :
 * `GET /provider/recherche` sans position = tous les lieux actifs (avec ou sans
 * coordonnées). Les lignes sont réduites ici, côté serveur, aux champs affichés.
 */
export default async function ReseauDeSoinsPage() {
  const res = await apiFetch('/api/v1/provider/recherche');
  const erreur = res.ok ? null : await messageErreur(res);
  let lieux: LieuAnnuaire[] = [];
  if (res.ok) {
    const corps = (await res.json()) as {
      etablissements?: Record<string, unknown>[];
      pharmacies?: Record<string, unknown>[];
    };
    lieux = [
      ...(corps.etablissements ?? []).map((l) => depuisApi(l, 'ETABLISSEMENT')),
      ...(corps.pharmacies ?? []).map((l) => depuisApi(l, 'PHARMACIE')),
    ].sort(parNom);
  }

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Réseau de soins"
        description="Établissements de santé et pharmacies conventionnés. Cliquez sur un nom pour obtenir l’itinéraire depuis votre position."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <ReseauSoinsRecherche lieux={lieux} />}
    </div>
  );
}
