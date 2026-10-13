import type { Metadata } from 'next';

import {
  MedicamentsEcran,
  type MedicamentReference,
} from '@/components/dashboard/pharmacie/medicaments-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Médicaments remboursables — Pharmacien' };

export default async function MedicamentsPage() {
  const [res, etat] = await Promise.all([
    apiFetch('/api/v1/pharmacy/medicaments-remboursables'),
    exigerIdentite('/dashboard-pharmacie/pharmacien/medicaments'),
  ]);
  const medicaments: MedicamentReference[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);
  // écriture réservée au pharmacien (rôle propre) : la caissière et le comptable lisent seulement
  const peutModifier = etat.kind === 'ok' && etat.identity.profil.role === 'PHARMACIE_PHARMACIEN';

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Médicaments remboursables"
        description="Les médicaments du catalogue national activés par votre assureur — sans les actes. Vous tenez votre liste (ajout, disponibilité, note) ; les tarifs du catalogue national ne sont jamais modifiés."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <MedicamentsEcran medicaments={medicaments} peutModifier={peutModifier} />}
    </div>
  );
}
