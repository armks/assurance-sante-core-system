import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import {
  ParametresEcran,
  type Parametre,
} from '@/components/superadmin/parametres-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Paramètres — Super administration' };

export default async function Parametres() {
  const res = await apiFetch('/api/v1/superadmin/config/parametres');
  const parametres: Parametre[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Paramètres de la plateforme"
        description="Devises, pays et villes, taux de taxe, langues. Lecture et écriture réservées au SUPERADMIN_PRINCIPAL."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ParametresEcran parametres={parametres} />
      )}
    </div>
  );
}
