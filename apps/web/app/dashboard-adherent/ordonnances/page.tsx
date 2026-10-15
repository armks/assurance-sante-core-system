import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import type { RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import type { AdherentDetail } from '@/components/dashboard/adherents/types';
import {
  OrdonnancesEcran,
  type CodeOrdonnance,
} from '@/components/dashboard/adherent/ordonnances-ecran';
import { PageTitre } from '@/components/page-titre';
import type { PageServeur } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import { PAGE_VIDE, requeteListe, type ParametresUrl } from '@/lib/liste-serveur';
import { bornesPeriode, periodeDemandee } from '@/lib/periode-rapide';

export const metadata: Metadata = { title: 'Ordonnances — Adhérent' };

export default async function OrdonnancesPage({
  searchParams,
}: {
  searchParams: Promise<ParametresUrl>;
}) {
  const etat = await exigerIdentite('/dashboard-adherent/ordonnances');
  if (etat.kind !== 'ok') redirect('/dashboard');
  const adherentId = etat.identity.permissions.scope.adherentId;

  const params = await searchParams;
  const un = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const periode = periodeDemandee(un('periode'));
  const { du, au } = bornesPeriode(periode, un('du'), un('au'));
  const filtres = requeteListe({ ...params, du, au }, ['du', 'au', 'statut', 'carte']);
  const sansPage = filtres.replace(/[?&](page|limite)=[^&]*/g, '').replace(/^&/, '?');

  const [res, resRecap, resAdherent] = await Promise.all([
    apiFetch(`/api/v1/preauthorization/codes-ordonnance${filtres}`),
    apiFetch(`/api/v1/preauthorization/codes-ordonnance/recapitulatif${sansPage}`),
    adherentId ? apiFetch(`/api/v1/member/adherents/${adherentId}`) : Promise.resolve(null),
  ]);
  const codes: PageServeur<CodeOrdonnance> = res.ok ? await res.json() : PAGE_VIDE;
  const erreur = res.ok ? null : await messageErreur(res);
  const recap: RecapDispensations | null = resRecap.ok ? await resRecap.json() : null;
  const adherent: AdherentDetail | null = resAdherent && resAdherent.ok ? await resAdherent.json() : null;
  const cartesFamille = adherent
    ? [
        { numeroCarte: adherent.numeroCarte, nom: `${adherent.prenom} ${adherent.nom} (titulaire)` },
        ...(adherent.beneficiaires ?? [])
          .filter((b) => b.numeroCarte)
          .map((b) => ({ numeroCarte: b.numeroCarte!, nom: `${b.prenom} ${b.nom}` })),
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageTitre
        titre="Mes ordonnances"
        description="Ordonnances du jour par défaut — le code de retrait reste visible tant qu’il n’a pas été entièrement délivré en pharmacie."
        uneLigne
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <OrdonnancesEcran codes={codes} recap={recap} periode={periode} cartesFamille={cartesFamille} />
      )}
    </div>
  );
}
