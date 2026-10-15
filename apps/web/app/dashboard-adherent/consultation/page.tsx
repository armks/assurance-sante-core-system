import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import type { RecapDispensations } from '@/app/dashboard-pharmacie/dispensation-types';
import type { AdherentDetail } from '@/components/dashboard/adherents/types';
import {
  ConsultationEcran,
  type CodeConsultation,
  type EtablissementOption,
} from '@/components/dashboard/adherent/consultation-ecran';
import { PageTitre } from '@/components/page-titre';
import type { PageServeur } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';
import { PAGE_VIDE, requeteListe, type ParametresUrl } from '@/lib/liste-serveur';
import { exigerIdentite } from '@/lib/identity';
import { bornesPeriode, periodeDemandee } from '@/lib/periode-rapide';
import { niveauCategorieEtablissement } from '@/lib/reseau';

export const metadata: Metadata = { title: 'Consultation — Adhérent' };

type AdherentPoliceOnly = AdherentDetail;

export default async function ConsultationPage({
  searchParams,
}: {
  searchParams: Promise<ParametresUrl>;
}) {
  const etat = await exigerIdentite('/dashboard-adherent/consultation');
  if (etat.kind !== 'ok') redirect('/dashboard');

  const adherentId = etat.identity.permissions.scope.adherentId;
  if (!adherentId) {
    return (
      <div className="space-y-8">
        <PageTitre titre="Consultation" />
        <p className="text-sm text-destructive">
          Votre compte n’est rattaché à aucun adhérent — contactez votre assureur.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const un = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const periode = periodeDemandee(un('periode'));
  const { du, au } = bornesPeriode(periode, un('du'), un('au'));
  const filtres = requeteListe({ ...params, du, au }, ['du', 'au', 'statut', 'carte']);
  const sansPage = filtres.replace(/[?&](page|limite)=[^&]*/g, '').replace(/^&/, '?');

  const [resEtabs, resAdherent, resCodes, resRecap] = await Promise.all([
    apiFetch('/api/v1/provider/etablissements?statut=ACTIF'),
    apiFetch(`/api/v1/member/adherents/${adherentId}`),
    apiFetch(`/api/v1/preauthorization/codes-consultation${filtres}`),
    apiFetch(`/api/v1/preauthorization/codes-consultation/recapitulatif${sansPage}`),
  ]);

  const tousEtablissements: EtablissementOption[] = resEtabs.ok ? await resEtabs.json() : [];
  const erreur = resEtabs.ok ? null : await messageErreur(resEtabs);
  const adherent: AdherentPoliceOnly | null = resAdherent.ok ? await resAdherent.json() : null;
  // Niveau d'accès de la formule : on ne propose que les établissements de sa catégorie ou d'une catégorie inférieure.
  const niveauFormule = niveauCategorieEtablissement(adherent?.police?.produit?.niveauAccesEtablissement ?? 'POLYCLINIQUE');
  const accessibles = new Set(
    tousEtablissements.filter((e) => niveauCategorieEtablissement(e.categorieEtablissement) <= niveauFormule).map((e) => e.id),
  );
  const codes: PageServeur<CodeConsultation> = resCodes.ok ? await resCodes.json() : PAGE_VIDE;
  const recap: RecapDispensations | null = resRecap.ok ? await resRecap.json() : null;
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
        titre="Mes consultations"
        description="Consultations du jour par défaut — demandez un code, à transmettre oralement à l’accueil de l’établissement."
        uneLigne
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ConsultationEcran
          etablissements={tousEtablissements}
          accessibles={[...accessibles]}
          policeId={adherent?.police?.id ?? null}
          codes={codes}
          recap={recap}
          periode={periode}
          cartesFamille={cartesFamille}
        />
      )}
    </div>
  );
}
