import type { Metadata } from 'next';

import { AnnoncesEcran, type AnnonceGestion } from '@/components/dashboard/annonces-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Annonces — Assurance Informatique' };

export default async function AnnoncesPage() {
  const res = await apiFetch('/api/v1/vitrine/annonces');
  const annonces: AnnonceGestion[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-6">
      <PageTitre
        titre="Annonces"
        description="Messages défilant de gauche à droite dans un bandeau fixé au bas de la page d’accueil de votre société, puis disparaissant après la durée choisie."
        uneLigne
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <AnnoncesEcran annonces={annonces} />}
    </div>
  );
}
