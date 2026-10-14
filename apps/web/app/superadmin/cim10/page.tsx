import type { Metadata } from 'next';

import { Cim10Ecran, type PageMaladies } from '@/components/superadmin/cim10-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Maladies CIM-10 — Super administration' };

/** Référentiel des maladies codées : alimenté ici, consulté par les médecins pour le diagnostic des consultations. */
export default async function MaladiesCim10({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; statut?: string }>;
}) {
  const { q, page, statut } = await searchParams;
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (page) qs.set('page', page);
  if (statut) qs.set('statut', statut);
  const res = await apiFetch(`/api/v1/cim10/admin?${qs.toString()}`);
  const donnees: PageMaladies | null = res.ok ? await res.json() : null;
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Maladies (classification CIM-10)"
        description="Le médecin choisit le diagnostic d’une consultation dans cette liste (code + maladie) ; seul le code est conservé dans le dossier. Ajoutez les maladies une à une ou importez la classification de l’OMS (fichier CSV « code;libellé »)."
      />
      {donnees ? <Cim10Ecran donnees={donnees} /> : <p className="text-sm text-destructive">{erreur}</p>}
    </div>
  );
}
