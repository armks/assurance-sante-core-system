import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageAccueil } from '@/components/accueil/page-accueil';
import { aUneSession } from '@/lib/identity';
import { chargerAnnoncesPubliques } from '@/lib/annonces-publiques';
import { chargerEvenementsPublics } from '@/lib/evenements-publics';
import { chargerPartenairesPublics } from '@/lib/partenaires-publics';
import { chargerStatistiquesPubliques } from '@/lib/statistiques-publiques';

export const metadata: Metadata = {
  title: 'Assurance Santé : la plateforme de l’assurance santé collective',
  description:
    'Réseau de soins conventionné, parcours anti-fraude, cotisations et remboursements : la plateforme de gestion de l’assurance santé collective en Côte d’Ivoire.',
};

/**
 * Page d'accueil publique (hors authentification). Un utilisateur déjà
 * connecté est renvoyé vers son tableau de bord, comme auparavant. Structure
 * partagée avec les pages des sociétés (`/[slug]`) : `PageAccueil`.
 */
export default async function Accueil() {
  if (await aUneSession()) {
    redirect('/dashboard');
  }
  const [statistiques, evenements, partenaires, annonces] = await Promise.all([
    chargerStatistiquesPubliques(),
    chargerEvenementsPublics(),
    chargerPartenairesPublics(),
    chargerAnnoncesPubliques(),
  ]);

  return <PageAccueil statistiques={statistiques} evenements={evenements} partenaires={partenaires} annonces={annonces} />;
}
