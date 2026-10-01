import type { Metadata } from 'next';

import {
  DemandesAdhesionEcran,
  type DemandeAdhesion,
} from '@/components/dashboard/demandes-adhesion-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Demandes d’adhésion — Assurance' };

export default async function DemandesAdhesionPage() {
  const res = await apiFetch('/api/v1/vitrine/demandes-adhesion');
  const demandes: DemandeAdhesion[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Demandes d’adhésion"
        description="Demandes reçues par le formulaire « Adhésion » de la page d’accueil de votre société. Chaque demande est enregistrée, même si l’e-mail de notification n’a pas pu partir."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DemandesAdhesionEcran demandes={demandes} />
      )}
    </div>
  );
}
