import type { Metadata } from 'next';

import { listerDispensationsPharmacie, recapitulatifDispensations } from '@/app/dashboard-pharmacie/dispensation-actions';
import { DispensationsListeEcran } from '@/components/dashboard/pharmacie/dispensations-liste-ecran';
import { PageTitre } from '@/components/page-titre';
import { requeteListe, type ParametresUrl } from '@/lib/liste-serveur';

export const metadata: Metadata = { title: 'Suivi des dispensations — Comptable' };

/**
 * Bascule sur le module `pharmacy/` (verrou par ligne) — corrige
 * l'incohérence relevée à l'audit : cet écran lisait encore l'ancien
 * mécanisme `codes_ordonnance` (PROMPT 19), qui ne reçoit plus d'écriture
 * depuis la révision majeure. Lecture seule des dispensations PAYEE
 * uniquement (filtré côté serveur) — cohérent avec le rôle déjà en place
 * avant cette bascule, aucune action de préparation/paiement ici.
 */
export default async function ComptablePage({
  searchParams,
}: {
  searchParams: Promise<ParametresUrl>;
}) {
  const filtres = requeteListe(await searchParams, ['q', 'du', 'au']);
  const [dispensations, recap] = await Promise.all([
    listerDispensationsPharmacie(filtres, 'PAYEE'),
    recapitulatifDispensations(`${filtres}${filtres ? '&' : '?'}statut=PAYEE`),
  ]);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Suivi des dispensations"
        description="Dispensations réglées de votre pharmacie — montants et historique."
      />
      <DispensationsListeEcran
        dispensations={dispensations}
        recap={recap}
        filtreStatut={false}
        vide="Aucune dispensation réglée ne correspond à ces critères."
      />
    </div>
  );
}
