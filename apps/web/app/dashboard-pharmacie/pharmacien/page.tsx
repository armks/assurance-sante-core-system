import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { listerDispensationsPharmacie } from '@/app/dashboard-pharmacie/dispensation-actions';
import type { LigneStock } from '@/app/dashboard-pharmacie/dispensation-types';
import { DispensationFlowEcran } from '@/components/dashboard/pharmacie/dispensation-flow-ecran';
import { DispensationsListeEcran } from '@/components/dashboard/pharmacie/dispensations-liste-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Dispensation — Pharmacien' };

const CIBLE = '/dashboard-pharmacie/pharmacien';

/**
 * Bascule sur le module `pharmacy/` (verrou par ligne) — corrige
 * l'incohérence relevée à l'audit : cet écran lisait encore l'ancien
 * mécanisme `codes_ordonnance` (PROMPT 19), qui ne reçoit plus d'écriture
 * depuis la révision majeure. Réutilise `DispensationFlowEcran` (partagé
 * avec la caissière — substitution active pour ce rôle) et ajoute
 * l'historique complet (tous statuts) de la pharmacie, absent côté
 * caissière.
 */
export default async function PharmacienPage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const [resStock, dispensations] = await Promise.all([
    apiFetch('/api/v1/pharmacy/stock'),
    listerDispensationsPharmacie(),
  ]);
  const stock: LigneStock[] = resStock.ok ? await resStock.json() : [];
  const erreur = resStock.ok ? null : await messageErreur(resStock);

  return (
    <div className="space-y-10">
      <div className="space-y-8">
        <PageTitre
          titre="Dispensation"
          description="Recherchez un patient par numéro de carte pour préparer une dispensation."
        />
        {erreur ? (
          <p className="text-sm text-destructive">{erreur}</p>
        ) : (
          <DispensationFlowEcran role="PHARMACIEN" cible={CIBLE} stockInitial={stock} />
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Historique des dispensations de votre pharmacie
        </h2>
        <DispensationsListeEcran
          dispensations={dispensations}
          vide="Aucune dispensation pour l’instant."
        />
      </div>
    </div>
  );
}
