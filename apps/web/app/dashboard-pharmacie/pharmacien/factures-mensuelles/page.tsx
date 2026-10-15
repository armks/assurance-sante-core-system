import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  FacturesMensuellesEcran,
  type FactureMensuelle,
} from '@/components/dashboard/pharmacie/factures-mensuelles-ecran';
import { chargerApercuFactureMensuelle, type MoisApercu } from '@/app/dashboard-pharmacie/facture-mensuelle-apercu';
import { PageTitre } from '@/components/page-titre';
import type { ParametresUrl } from '@/lib/liste-serveur';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Factures mensuelles — Pharmacien' };

const CIBLE = '/dashboard-pharmacie/pharmacien/factures-mensuelles';

export default async function PharmacienFacturesMensuellesPage({ searchParams }: { searchParams: Promise<ParametresUrl> }) {
  const etat = await exigerIdentite(CIBLE);
  if (etat.kind !== 'ok') redirect('/dashboard');

  const mois: MoisApercu = (await searchParams).mois === 'courant' ? 'courant' : 'precedent';
  const [res, { apercu, erreur: erreurApercu }] = await Promise.all([
    apiFetch('/api/v1/pharmacy/factures-mensuelles/mes-factures'),
    chargerApercuFactureMensuelle(mois),
  ]);
  const factures: FactureMensuelle[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? erreurApercu : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Factures mensuelles"
        description="Consolidation mensuelle du montant dû par l’assureur pour vos dispensations payées."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <FacturesMensuellesEcran factures={factures} cible={CIBLE} apercu={apercu} mois={mois} />
      )}
    </div>
  );
}
