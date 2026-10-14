import type { Metadata } from 'next';

import { PartenairesEcran, type PartenaireGestion } from '@/components/dashboard/partenaires-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Logos partenaires — Assurance Informatique' };

export default async function PartenairesPage() {
  const [res, resHero] = await Promise.all([apiFetch('/api/v1/vitrine/partenaires'), apiFetch('/api/v1/vitrine/hero')]);
  const partenaires: PartenaireGestion[] = res.ok ? await res.json() : [];
  const slug: string | null = resHero.ok ? ((await resHero.json()) as { slug: string | null }).slug : null;
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Logos partenaires"
        description="Les logos de vos partenaires défilent en bandeau sur la page d’accueil de votre société, juste après la bannière d’en-tête. Chaque société gère ses propres logos."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <PartenairesEcran partenaires={partenaires} slug={slug} />}
    </div>
  );
}
