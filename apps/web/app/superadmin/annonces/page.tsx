import type { Metadata } from 'next';

import { AnnoncesEcran, type AnnonceGestion } from '@/components/dashboard/annonces-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Annonces — Superadmin' };

export default async function AnnoncesSuperadminPage() {
  const [res, resSocietes] = await Promise.all([apiFetch('/api/v1/vitrine/annonces'), apiFetch('/api/v1/identity/organisations')]);
  const annonces: AnnonceGestion[] = res.ok ? await res.json() : [];
  const societes: { id: string; nom: string }[] = resSocietes.ok
    ? ((await resSocietes.json()) as { id: string; nom: string }[]).map((s) => ({ id: s.id, nom: s.nom }))
    : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-6">
      <PageTitre
        titre="Annonces"
        description="Bandeau défilant au bas des pages d’accueil : diffusez un message à toute la plateforme ou à la page d’accueil d’une société."
        uneLigne
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <AnnoncesEcran annonces={annonces} superadmin societes={societes} />}
    </div>
  );
}
