import type { Metadata } from 'next';

import { EvenementsEcran, type EvenementGestion } from '@/components/dashboard/evenements-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Événements — Assurance Informatique' };

export default async function EvenementsPage() {
  const res = await apiFetch('/api/v1/vitrine/evenements');
  const evenements: EvenementGestion[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Événements"
        description="Carrousel du bloc « Qui sommes-nous » de la page d’accueil : jusqu’à 5 événements actifs, par ordre d’affichage puis par date."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <EvenementsEcran evenements={evenements} />}
    </div>
  );
}
