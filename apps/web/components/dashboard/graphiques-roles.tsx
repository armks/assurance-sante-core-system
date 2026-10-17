'use client';

import { BarChart3, Building2, FileText, KeyRound, Pill, ShieldCheck, Wallet } from 'lucide-react';

import { useCategoriesActe } from '@/components/categories-acte';
import { CarteGraphique, COULEUR, GraphiqueBarres, GraphiqueDonut, PALETTE_GRAPHIQUES, type PointDonut } from '@/components/dashboard/graphiques';

/** « EN_ATTENTE » → « En attente » : repli lisible quand aucun libellé métier n'est connu. */
const joli = (code: string) => {
  const t = code.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Compte les éléments par clé et en fait des parts de donut (couleurs imposées ou palette). */
function repartition<T>(
  lignes: T[],
  cle: (l: T) => string,
  libelles: Record<string, string> = {},
  couleurs: Record<string, string> = {},
): PointDonut[] {
  const m = new Map<string, number>();
  for (const l of lignes) m.set(cle(l), (m.get(cle(l)) ?? 0) + 1);
  return [...m].map(([k, v], i) => ({
    nom: libelles[k] ?? joli(k),
    valeur: v,
    couleur: couleurs[k] ?? PALETTE_GRAPHIQUES[i % PALETTE_GRAPHIQUES.length],
  }));
}

const COULEUR_COTISATION: Record<string, string> = {
  PAYEE: COULEUR.vert,
  A_PAYER: COULEUR.ambre,
  EN_RETARD: COULEUR.rose,
  ANNULEE: COULEUR.violet,
};
const LIBELLE_COTISATION: Record<string, string> = { A_PAYER: 'À payer', PAYEE: 'Payée', EN_RETARD: 'En retard', ANNULEE: 'Annulée' };

/** Cotisations d'une société : répartition par statut, puis montants dus et payés par statut. */
export function GraphiquesCotisations({
  cotisations,
}: {
  cotisations: { statut: string; montantDu: string | number; montantPaye: string | number }[];
}) {
  if (cotisations.length === 0) return null;
  const parStatut = new Map<string, { nom: string; du: number; paye: number }>();
  for (const c of cotisations) {
    const l = parStatut.get(c.statut) ?? { nom: LIBELLE_COTISATION[c.statut] ?? joli(c.statut), du: 0, paye: 0 };
    l.du += Number(c.montantDu);
    l.paye += Number(c.montantPaye);
    parStatut.set(c.statut, l);
  }
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques">
      <CarteGraphique titre="Cotisations par statut" description={`${cotisations.length} cotisation(s)`} icon={Wallet} couleur={COULEUR.ambre}>
        <GraphiqueDonut donnees={repartition(cotisations, (c) => c.statut, LIBELLE_COTISATION, COULEUR_COTISATION)} libelleTotal="cotisations" />
      </CarteGraphique>
      <CarteGraphique titre="Montants dus et payés" description="Par statut de cotisation" icon={BarChart3} couleur={COULEUR.vert}>
        <GraphiqueBarres
          monetaire
          donnees={[...parStatut.values()]}
          series={[
            { cle: 'du', nom: 'Dû', couleur: COULEUR.indigo },
            { cle: 'paye', nom: 'Payé', couleur: COULEUR.vert },
          ]}
        />
      </CarteGraphique>
    </section>
  );
}

/** Vue d'ensemble de l'adhérent : réclamations par statut et consommation des plafonds de la famille par garantie. */
export function GraphiquesAdherent({
  reclamations,
  plafonds,
}: {
  reclamations: { statut: string }[];
  plafonds: { garanties: { categorieActe: string; plafondFamille: number | null; consommeFamille: number | null }[] } | null;
}) {
  const { libelle: libelleCategorie } = useCategoriesActe();
  const garanties = (plafonds?.garanties ?? [])
    .filter((g) => g.plafondFamille !== null && g.plafondFamille > 0)
    .map((g) => {
      const consomme = Number(g.consommeFamille ?? 0);
      const plafond = Number(g.plafondFamille);
      return { nom: libelleCategorie(g.categorieActe), consomme, restant: Math.max(0, plafond - consomme) };
    });
  if (reclamations.length === 0 && garanties.length === 0) return null;
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques">
      {reclamations.length > 0 && (
        <CarteGraphique titre="Mes réclamations" description={`${reclamations.length} réclamation(s) par statut`} icon={FileText} couleur={COULEUR.cyan}>
          <GraphiqueDonut donnees={repartition(reclamations, (r) => r.statut)} libelleTotal="réclamations" />
        </CarteGraphique>
      )}
      {garanties.length > 0 && (
        <CarteGraphique titre="Plafonds de la famille" description="Consommé et restant par garantie" icon={ShieldCheck} couleur={COULEUR.vert}>
          <GraphiqueBarres
            horizontal
            empile
            monetaire
            donnees={garanties}
            series={[
              { cle: 'consomme', nom: 'Consommé', couleur: COULEUR.rose },
              { cle: 'restant', nom: 'Restant', couleur: COULEUR.vert },
            ]}
          />
        </CarteGraphique>
      )}
    </section>
  );
}

/** Superadmin : organisations par statut et licences par plan. */
export function GraphiquesOrganisations({
  organisations,
}: {
  organisations: { statut: string; licence: { plan: string } | null }[];
}) {
  if (organisations.length === 0) return null;
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques">
      <CarteGraphique titre="Organisations par statut" description={`${organisations.length} organisation(s)`} icon={Building2} couleur={COULEUR.indigo}>
        <GraphiqueDonut
          donnees={repartition(organisations, (o) => o.statut, { ACTIVE: 'Active', SUSPENDUE: 'Suspendue', ARCHIVEE: 'Archivée' }, { ACTIVE: COULEUR.vert, SUSPENDUE: COULEUR.ambre, ARCHIVEE: COULEUR.violet })}
          libelleTotal="organisations"
        />
      </CarteGraphique>
      <CarteGraphique titre="Licences par plan" description="Plan de licence de chaque organisation" icon={KeyRound} couleur={COULEUR.violet}>
        <GraphiqueDonut donnees={repartition(organisations, (o) => o.licence?.plan ?? 'SANS_LICENCE', { SANS_LICENCE: 'Sans licence' })} libelleTotal="licences" />
      </CarteGraphique>
    </section>
  );
}

/** Pharmacie : part de l'assurance et part du patient sur les dispensations du périmètre filtré. */
export function GraphiqueRepartitionDispensations({
  recap,
}: {
  recap: { nombre: number; montantAssurance: string; montantPatient: string } | null;
}) {
  const assurance = Number(recap?.montantAssurance ?? 0);
  const patient = Number(recap?.montantPatient ?? 0);
  if (!recap || assurance + patient === 0) return null;
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Graphiques">
      <CarteGraphique titre="Répartition des montants" description={`${recap.nombre} dispensation(s)`} icon={Pill} couleur={COULEUR.vert}>
        <GraphiqueDonut
          formatValeur={(n) => `${Math.round(n).toLocaleString('fr-FR')} F`}
          donnees={[
            { nom: 'Part assurance', valeur: assurance, couleur: COULEUR.indigo },
            { nom: 'Part patient', valeur: patient, couleur: COULEUR.rose },
          ]}
          libelleTotal="montant total"
        />
      </CarteGraphique>
    </section>
  );
}
