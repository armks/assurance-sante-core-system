import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import { redirect } from 'next/navigation';

import { BandeauPartenaires } from '@/components/accueil/bandeau-partenaires';
import { CarrouselHero } from '@/components/accueil/carrousel-hero';
import { CeQueNousFaisons } from '@/components/accueil/ce-que-nous-faisons';
import { EnTeteAccueil } from '@/components/accueil/en-tete';
import { Formulaires } from '@/components/accueil/formulaires';
import { PiedDePage } from '@/components/accueil/pied-de-page';
import { QuiSommesNous } from '@/components/accueil/qui-sommes-nous';
import { ReseauSoins } from '@/components/accueil/reseau-soins';
import { aUneSession } from '@/lib/identity';
import { chargerStatistiquesPubliques } from '@/lib/statistiques-publiques';

/** Titres de la page d'accueil uniquement (les tableaux de bord gardent la police système). */
const outfit = Outfit({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: 'Assurance Santé : la plateforme de l’assurance santé collective',
  description:
    'Réseau de soins conventionné, parcours anti-fraude, cotisations et remboursements : la plateforme de gestion de l’assurance santé collective en Côte d’Ivoire.',
};

/**
 * Page d'accueil publique (hors authentification). Un utilisateur déjà
 * connecté est renvoyé vers son tableau de bord, comme auparavant.
 */
export default async function Accueil() {
  if (await aUneSession()) {
    redirect('/dashboard');
  }
  const statistiques = await chargerStatistiquesPubliques();

  return (
    <div className={`${outfit.variable} flex min-h-svh flex-col bg-background`}>
      <EnTeteAccueil />
      <main id="contenu-principal" className="flex-1">
        <CarrouselHero />
        <BandeauPartenaires />
        <QuiSommesNous />
        <CeQueNousFaisons statistiques={statistiques} />
        <ReseauSoins />
        <Formulaires />
      </main>
      <PiedDePage />
    </div>
  );
}
