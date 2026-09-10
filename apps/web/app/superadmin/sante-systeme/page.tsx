import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import {
  SanteSystemeEcran,
  type SanteSysteme,
} from '@/components/superadmin/sante-systeme-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Santé système — Super administration',
};

export default async function SanteSystemePage() {
  const res = await apiFetch('/api/v1/superadmin/sante-systeme');
  const erreur = res.ok ? null : await messageErreur(res);
  const sante: SanteSysteme | null = res.ok ? await res.json() : null;

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Santé du système"
        description="Vue agrégée des organisations : statut, licence, consommation du quota d’adhérents, dernière activité."
      />
      {erreur || !sante ? (
        <p className="text-sm text-destructive">
          {erreur ?? 'Données indisponibles.'}
        </p>
      ) : (
        <SanteSystemeEcran sante={sante} />
      )}
    </div>
  );
}
