import { createClient } from '@supabase/supabase-js';
import type { Metadata } from 'next';
import localFont from 'next/font/local';

import { EnTeteAccueil } from '@/components/accueil/en-tete';
import { PiedDePage } from '@/components/accueil/pied-de-page';
import { depuisVuePublique, parNom, type LieuAnnuaire } from '@/components/reseau-soins/lieu';
import { ReseauSoinsRecherche } from '@/components/reseau-soins/reseau-soins-recherche';

// Police hébergée avec l'application (voir components/accueil/page-accueil.tsx).
const outfit = localFont({ src: '../fonts/Outfit-latin.woff2', weight: '100 900', variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: 'Réseau de soins : établissements et pharmacies conventionnés',
  description:
    'Annuaire des établissements de santé et pharmacies conventionnés en Côte d’Ivoire : filtrez par ville, commune, type et garde, et obtenez l’itinéraire.',
};

/**
 * Lecture PUBLIQUE, sans session : client Supabase avec la seule clé publique
 * (rôle `anon`), qui n'a accès qu'aux vues `etablissements_sante_public` et
 * `pharmacies_public` (PROMPT 14 : colonnes limitées, lieux actifs uniquement ;
 * la RLS renvoie zéro ligne sur les tables complètes). Jamais l'API
 * authentifiée ni la clé service. Colonnes demandées explicitement.
 */
async function chargerLieux(): Promise<{ lieux: LieuAnnuaire[]; erreur: boolean }> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [etabs, pharmas] = await Promise.all([
    supabase
      .from('etablissements_sante_public')
      .select('id, nom, ville, commune, type_etablissement, garde_weekend, latitude, longitude'),
    supabase.from('pharmacies_public').select('id, nom, ville, commune, garde_weekend, latitude, longitude'),
  ]);
  if (etabs.error || pharmas.error) return { lieux: [], erreur: true };
  return {
    lieux: [
      ...etabs.data.map((l) => depuisVuePublique(l, 'ETABLISSEMENT')),
      ...pharmas.data.map((l) => depuisVuePublique(l, 'PHARMACIE')),
    ].sort(parNom),
    erreur: false,
  };
}

export default async function ReseauDeSoinsPublic() {
  const { lieux, erreur } = await chargerLieux();

  return (
    <div className={`${outfit.variable} flex min-h-svh flex-col bg-background`}>
      <EnTeteAccueil />
      <main id="contenu-principal" className="flex-1 py-[2.625rem] md:py-[3.625rem]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Réseau de soins</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Établissements et pharmacies conventionnés
          </h1>
          <p className="mt-4 max-w-[65ch] leading-relaxed text-muted-foreground">
            Trouvez un lieu de soins par ville, commune, type ou garde le week-end. Cliquez sur un nom pour ouvrir
            l’itinéraire dans Google Maps depuis votre position.
          </p>
          <div className="mt-8 min-w-0 rounded-2xl border bg-card p-4 sm:p-6">
            {erreur ? (
              <p role="alert" className="text-sm text-destructive">
                L’annuaire est momentanément indisponible. Merci de réessayer dans quelques instants.
              </p>
            ) : (
              <ReseauSoinsRecherche lieux={lieux} />
            )}
          </div>
        </div>
      </main>
      <PiedDePage />
    </div>
  );
}
