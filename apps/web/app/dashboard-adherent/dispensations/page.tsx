import type { Metadata } from 'next';

import {
  DispensationsEcran,
  type DispensationAdherent,
} from '@/components/dashboard/adherent/dispensations-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Dispensations — Adhérent' };

export default async function DispensationsPage() {
  const res = await apiFetch('/api/v1/pharmacy/dispensations/mes-dispensations');
  const dispensations: DispensationAdherent[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Mes dispensations"
        description="Le code de confirmation reste visible tant que la pharmacie attend votre validation. Toutes vos dispensations apparaissent ici, quelle que soit la pharmacie."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DispensationsEcran dispensations={dispensations} />
      )}
    </div>
  );
}
