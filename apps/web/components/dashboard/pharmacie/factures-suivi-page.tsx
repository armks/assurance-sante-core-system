import { listerDispensationsPharmacie, recapitulatifDispensations } from '@/app/dashboard-pharmacie/dispensation-actions';
import { PageTitre } from '@/components/page-titre';
import { requeteListe, type ParametresUrl } from '@/lib/liste-serveur';

import { FacturesSuiviEcran } from './factures-suivi-ecran';

const jour = (d: Date) => d.toISOString().slice(0, 10);

/** Bornes (dates incluses, UTC = Abidjan) de la période choisie : jour (défaut), semaine du lundi, mois en cours. */
function bornes(periode: string, du?: string, au?: string): { du?: string; au?: string } {
  const n = new Date();
  if (periode === 'perso') return { du, au };
  if (periode === 'mois') {
    return {
      du: jour(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))),
      au: jour(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0))),
    };
  }
  if (periode === 'semaine') {
    const decalage = (n.getUTCDay() + 6) % 7; // lundi = 0
    const lundi = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - decalage));
    const dimanche = new Date(Date.UTC(lundi.getUTCFullYear(), lundi.getUTCMonth(), lundi.getUTCDate() + 6));
    return { du: jour(lundi), au: jour(dimanche) };
  }
  return { du: jour(n), au: jour(n) };
}

/** Page « Factures » commune aux 3 profils de la pharmacie (même API, droits identiques). */
export async function FacturesSuiviPage({ searchParams }: { searchParams: ParametresUrl }) {
  const un = (k: string) => {
    const v = searchParams[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const periode = ['jour', 'semaine', 'mois', 'perso'].includes(un('periode') ?? '') ? un('periode')! : 'jour';
  const { du, au } = bornes(periode, un('du'), un('au'));
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
