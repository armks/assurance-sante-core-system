import { Outfit } from 'next/font/google';

import type { EvenementPublic } from '@/lib/evenements-publics';
import type { StatistiquesPubliques } from '@/lib/statistiques-publiques';

import { BandeauPartenaires } from './bandeau-partenaires';
import { CarrouselHero } from './carrousel-hero';
import { CeQueNousFaisons } from './ce-que-nous-faisons';
import { EnTeteAccueil } from './en-tete';
import { Formulaires } from './formulaires';
import type { MarqueVitrine } from './marque';
import { PiedDePage } from './pied-de-page';
import { QuiSommesNous } from './qui-sommes-nous';
import { ReseauSoins } from './reseau-soins';

/** Titres de la page d'accueil uniquement (les tableaux de bord gardent la police système). */
const outfit = Outfit({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

/**
 * Page d'accueil — structure UNIQUE partagée par la page principale de la
 * plateforme (`/`, sans `societe`) et la page de chaque société (`/{slug}`) :
 * même bannière, mêmes sections, même carrousel d'événements, mêmes
 * formulaires, même pied de page. Pour une société : son logo et son nom à la
 * place de ceux de la plateforme, ses événements seulement, ses formulaires
 * adressés à elle, liens de section restant sur sa page.
 */
export function PageAccueil({
  statistiques,
  evenements,
  societe,
}: {
  statistiques: StatistiquesPubliques | null;
  evenements: EvenementPublic[];
  societe?: MarqueVitrine & { slug: string };
}) {
  const racine = societe ? `/${societe.slug}` : '/';
  return (
    <div className={`${outfit.variable} flex min-h-svh flex-col bg-background`}>
      <EnTeteAccueil marque={societe} racine={racine} />
      <main id="contenu-principal" className="flex-1">
        <CarrouselHero />
        <BandeauPartenaires />
        <QuiSommesNous evenements={evenements} />
        <CeQueNousFaisons statistiques={statistiques} />
        <ReseauSoins />
        <Formulaires organisation={societe?.slug} />
      </main>
      <PiedDePage marque={societe} racine={racine} />
    </div>
  );
}
