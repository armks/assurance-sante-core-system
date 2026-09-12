import type { Metadata } from 'next';

import { StockEcran } from '@/components/dashboard/pharmacie/stock-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Mon stock — Pharmacien' };

const CIBLE = '/dashboard-pharmacie/pharmacien/stock';

/**
 * Gestion du stock de la pharmacie (`stock_medicaments_pharmacie`) —
 * réservée à `PHARMACIE_PHARMACIEN` côté API (`assertPharmacien`). Distinct
 * de « Médicaments remboursables » (référentiel national, lecture seule) :
 * ici, c'est le tarif PROPRE à cette pharmacie, utilisé au moment de
 * dispenser.
 */
export default async function StockPage() {
  const res = await apiFetch('/api/v1/pharmacy/stock');
  const stock = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mon stock"
        description="Prix et disponibilité des médicaments dans votre pharmacie — utilisés au moment de dispenser."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <StockEcran stock={stock} cible={CIBLE} />}
    </div>
  );
}
