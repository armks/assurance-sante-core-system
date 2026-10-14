import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { PageAccueil } from '@/components/accueil/page-accueil';
import { chargerEvenementsPublics } from '@/lib/evenements-publics';
import { chargerPartenairesPublics } from '@/lib/partenaires-publics';
import { chargerOrganisationPublique } from '@/lib/organisation-publique';
import { estCheminSociete } from '@/lib/slugs';
import { chargerStatistiquesPubliques } from '@/lib/statistiques-publiques';

/** Une seule lecture de la fiche par requête (métadonnées + page). */
const societe = cache(async (slug: string) => (estCheminSociete(`/${slug}`) ? chargerOrganisationPublique(slug) : null));

export async function generateMetadata({ params }: PageProps<'/[slug]'>): Promise<Metadata> {
  const org = await societe((await params).slug);
  if (!org) return {};
  return {
    title: `${org.nom} : assurance santé collective`,
    description: `${org.nom} : réseau de soins conventionné, parcours anti-fraude, cotisations et remboursements.`,
  };
}

/**
 * Page d'accueil dédiée d'une société (/{slug}) : même structure que la page
 * principale (`PageAccueil`), avec son logo, son nom, sa bannière, SES
 * statistiques, SES événements, ses coordonnées et des formulaires qui lui
 * sont adressés. Slug inconnu, réservé ou société
 * inactive : 404. Publique, y compris pour un utilisateur connecté (pas de
 * renvoi vers le tableau de bord, contrairement à `/`).
 */
export default async function PageSociete({ params }: PageProps<'/[slug]'>) {
  const org = await societe((await params).slug);
  if (!org) notFound();
  const [statistiques, evenements, partenaires] = await Promise.all([
    chargerStatistiquesPubliques(org.slug),
    chargerEvenementsPublics(org.slug),
    chargerPartenairesPublics(org.slug),
  ]);

  return (
    <PageAccueil
      statistiques={statistiques}
      evenements={evenements}
      partenaires={partenaires}
      societe={{
        slug: org.slug,
        nom: org.nom,
        logoUrl: org.logoUrl,
        hero: { titre: org.heroTitre, sousTitre: org.heroSousTitre, imageUrl: org.heroImageUrl },
        contact: { email: org.emailContact, telephone: org.telephoneContact },
      }}
    />
  );
}
