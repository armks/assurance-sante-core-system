import localFont from 'next/font/local';

import type { EvenementPublic } from '@/lib/evenements-publics';
import type { StatistiquesPubliques } from '@/lib/statistiques-publiques';

import { BandeauPartenaires } from './bandeau-partenaires';
import { CarrouselHero, type HeroPersonnalise } from './carrousel-hero';
import { CeQueNousFaisons } from './ce-que-nous-faisons';
import { EnTeteAccueil } from './en-tete';
import { MemoireAccueil } from '@/components/memoire-accueil';
import { Formulaires } from './formulaires';
import type { MarqueVitrine } from './marque';
import { PiedDePage } from './pied-de-page';
import { QuiSommesNous } from './qui-sommes-nous';
import { ReseauSoins } from './reseau-soins';

/** Titres de la page d'accueil uniquement (les tableaux de bord gardent la police système). */
// Police hébergée avec l'application (sous-ensemble latin, poids variable 100–900) : le build ne dépend d'aucun accès réseau à Google Fonts.
const outfit = localFont({ src: '../../app/fonts/Outfit-latin.woff2', weight: '100 900', variable: '--font-display', display: 'swap' });

/**
 * Page d'accueil — structure UNIQUE partagée par la page principale de la
 * plateforme (`/`, sans `societe`) et la page de chaque société (`/{slug}`) :
 * même bannière, mêmes sections, même carrousel d'événements, mêmes
 * formulaires, même pied de page. Pour une société : son logo et son nom à la
 * place de ceux de la plateforme, sa bannière personnalisée (sinon celle de la
 * plateforme), SES statistiques et SES événements, ses formulaires adressés à
 * elle, ses coordonnées dans le pied de page, liens de section sur sa page.
 */
export function PageAccueil({
  statistiques,
  evenements,
  societe,
}: {
  statistiques: StatistiquesPubliques | null;
  evenements: EvenementPublic[];
  societe?: MarqueVitrine & {
    slug: string;
    hero: HeroPersonnalise;
    contact: { email: string | null; telephone: string | null };
  };
}) {
  const racine = societe ? `/${societe.slug}` : '/';
  return (
    <div className={`${outfit.variable} flex min-h-svh flex-col bg-background`}>
      <MemoireAccueil racine={racine} />
      <EnTeteAccueil marque={societe} racine={racine} />
      <main id="contenu-principal" className="flex-1">
        <CarrouselHero personnalisation={societe?.hero} />
        <BandeauPartenaires />
        <QuiSommesNous evenements={evenements} />
        <CeQueNousFaisons statistiques={statistiques} perimetre={societe?.nom} />
        <ReseauSoins />
        <Formulaires organisation={societe?.slug} />
      </main>
      <PiedDePage marque={societe} racine={racine} contact={societe?.contact} />
    </div>
  );
}
