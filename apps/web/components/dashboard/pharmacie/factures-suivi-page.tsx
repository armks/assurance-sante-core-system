import { listerDispensationsPharmacie, recapitulatifDispensations } from '@/app/dashboard-pharmacie/dispensation-actions';
import { PageTitre } from '@/components/page-titre';
import { requeteListe, type ParametresUrl } from '@/lib/liste-serveur';
import { bornesPeriode, periodeDemandee } from '@/lib/periode-rapide';

import { FacturesSuiviEcran } from './factures-suivi-ecran';

/** Page « Factures » commune aux 3 profils de la pharmacie (même API, droits identiques). */
export async function FacturesSuiviPage({ searchParams }: { searchParams: ParametresUrl }) {
  const un = (k: string) => {
    const v = searchParams[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const periode = periodeDemandee(un('periode'));
  const { du, au } = bornesPeriode(periode, un('du'), un('au'));
  const filtres: ParametresUrl = {
    ...searchParams,
    du,
    au,
    ...(un('statut') ? {} : { horsAnnulees: '1' }),
  };
  const cles = ['q', 'du', 'au', 'statut', 'carte', 'societe', 'formule', 'horsAnnulees'];
  const [factures, recap] = await Promise.all([
    listerDispensationsPharmacie(requeteListe(filtres, cles)),
    recapitulatifDispensations(requeteListe(filtres, cles)),
  ]);

  return (
    <div className="space-y-6">
      <PageTitre
        titre="Factures des prescriptions"
        description="Factures du jour par défaut — filtrez par carte, société, formule ou période ; le récapitulatif cumule coût, part assurance et part assuré."
        uneLigne
      />
      <FacturesSuiviEcran factures={factures} recap={recap} periode={periode} />
    </div>
  );
}
