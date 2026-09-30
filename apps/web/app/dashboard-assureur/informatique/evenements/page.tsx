import type { Metadata } from 'next';

import { EvenementsEcran, type EvenementGestion } from '@/components/dashboard/evenements-ecran';
import { HeroSociete, type HeroSocieteDonnees } from '@/components/dashboard/hero-societe';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Événements — Assurance Informatique' };

export default async function EvenementsPage() {
  const [res, resHero] = await Promise.all([apiFetch('/api/v1/vitrine/evenements'), apiFetch('/api/v1/vitrine/hero')]);
  const evenements: EvenementGestion[] = res.ok ? await res.json() : [];
  const hero: HeroSocieteDonnees | null = resHero.ok ? await resHero.json() : null;
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Événements"
        description="Bannière et carrousel du bloc « Qui sommes-nous » de la page d’accueil de votre société : jusqu’à 5 événements actifs, par ordre d’affichage puis par date."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <>
          {hero && <HeroSociete hero={hero} />}
          <EvenementsEcran evenements={evenements} />
        </>
      )}
    </div>
  );
}
