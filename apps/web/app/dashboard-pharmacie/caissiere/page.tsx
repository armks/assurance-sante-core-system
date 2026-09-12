import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DispensationFlowEcran } from '@/components/dashboard/pharmacie/dispensation-flow-ecran';
import type { LigneStock } from '@/app/dashboard-pharmacie/dispensation-types';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Dispensation — Caissière' };

const CIBLE = '/dashboard-pharmacie/caissiere';

/**
 * Vrai parcours de dispensation (module `pharmacy/`, verrou par ligne de
 * médicament) : recherche par numéro de carte → sélection d'une prescription
 * → lignes DISPONIBLE/SERVIE avec vérification stock de SA pharmacie → envoi
 * du code au patient → attente de validation → paiement.
 *
 * La caissière peut LIRE le stock (`GET /pharmacy/stock`, ouvert aux 3 rôles
 * PHARMACIE depuis cette reconstruction — clarification métier) mais ne peut
 * ni l'écrire ni substituer un médicament : ces deux actions restent
 * réservées à `PHARMACIE_PHARMACIEN` côté API (vérifié — `assertPharmacien`),
 * le bouton de substitution est donc affiché désactivé ici.
 */
export default async function CaissierePage() {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const res = await apiFetch('/api/v1/pharmacy/stock');
  const stock: LigneStock[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Dispensation"
        description="Recherchez un patient par numéro de carte pour préparer une dispensation."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <DispensationFlowEcran role="CAISSIERE" cible={CIBLE} stockInitial={stock} />
      )}
    </div>
  );
}
