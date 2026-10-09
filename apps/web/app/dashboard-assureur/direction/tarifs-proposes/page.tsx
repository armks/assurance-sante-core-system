import type { Metadata } from 'next';

import {
  MedecinConseilTarifsProposesEcran,
  type TarifAExaminer,
} from '@/components/dashboard/medecin-conseil-tarifs-proposes-ecran';
import type { PageServeur } from '@/components/dashboard/patterns';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { PAGE_VIDE, requeteListe, type ParametresUrl } from '@/lib/liste-serveur';

export const metadata: Metadata = { title: 'Tarifs proposés à examiner — Direction' };

export default async function TarifsProposesAExaminerPage({ searchParams }: { searchParams: Promise<ParametresUrl> }) {
  const params = await searchParams;
  const res = await apiFetch(
    `/api/v1/tarifs-proposes/file${requeteListe(params, ['statut', 'etablissementId', 'ancienneteMin', 'categorie'])}`,
  );
  const page: PageServeur<TarifAExaminer> = res.ok ? await res.json() : PAGE_VIDE;
  const erreur = res.ok ? null : await messageErreur(res);
  // établissements pour le filtre (conventions : liste de l'organisation) — jamais bloquant
  const resEtabs = await apiFetch('/api/v1/provider/etablissements').catch(() => null);
  const etablissements: { id: string; nom: string }[] = resEtabs && resEtabs.ok ? await resEtabs.json() : [];

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Tarifs proposés à examiner"
        description="Lecture seule (escalade) : les décisions sont prises par le médecin conseil. Les alertes renforcées sont en tête de file."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <MedecinConseilTarifsProposesEcran page={page} etablissements={etablissements} peutDecider={false} />
      )}
    </div>
  );
}
