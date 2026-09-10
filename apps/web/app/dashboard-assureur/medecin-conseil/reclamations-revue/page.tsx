import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { RevueManuelleFile } from '@/components/dashboard/reclamations/revue-manuelle-file';
import type { Reclamation } from '@/components/dashboard/reclamations/reclamations-liste';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Réclamations en revue — Médecin Conseil' };

export default async function ReclamationsRevueMedecinConseil() {
  const etat = await exigerIdentite(
    '/dashboard-assureur/medecin-conseil/reclamations-revue',
  );
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/claims/reclamations?statut=REVUE_MANUELLE');
  const reclamations: Reclamation[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Réclamations en revue manuelle"
        description="Réclamations à contenu médical que l’adjudication automatique n’a pas tranchées. Approuvez (avec montant ajusté éventuel) ou rejetez, avec motif."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <RevueManuelleFile
          reclamations={reclamations}
          roleChain={etat.identity.permissions.roleChain}
          baseDetail={null}
        />
      )}
    </div>
  );
}
