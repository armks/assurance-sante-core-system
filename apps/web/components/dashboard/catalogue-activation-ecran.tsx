'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  activationMasse,
  activerElement,
  desactiverElement,
  type ResultatActivation,
  type TypeCatalogue,
} from '@/app/dashboard-assureur/catalogue-actions';
import {
  Alerte,
  CarteResume,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

/** Élément du catalogue national avec l'état d'activation de l'organisation (`GET reference/catalogue-national/...`). */
export interface ElementCatalogue {
  id: string;
  code: string;
  libelle: string;
  /** Catégorie (actes) ou classe thérapeutique (médicaments). */
  rubrique: string | null;
  /** Complément : dosage · forme (médicaments), version de nomenclature (actes). */
  detail: string | null;
  /** Statut d'homologation AU CATALOGUE NATIONAL : seul un élément HOMOLOGUE s'active. */
  statutNational: string;
  actif: boolean;
  /** Statut de la ligne de l'organisation : HOMOLOGUE (actif), SUSPENDU (désactivé), null (jamais activé). */
  statutLocal: string | null;
}

const TEXTES: Record<TypeCatalogue, { singulier: string; pluriel: string; rubrique: string; recherche: string }> = {
  actes: { singulier: 'acte', pluriel: 'actes', rubrique: 'Catégorie', recherche: 'Code, libellé…' },
  medicaments: { singulier: 'médicament', pluriel: 'médicaments', rubrique: 'Classe thérapeutique', recherche: 'Dénomination, nom commercial, code…' },
};

function libelleEtat(e: ElementCatalogue): { statut: string; libelle: string; ton: 'succes' | 'attention' | 'neutre' } {
  if (e.statutNational !== 'HOMOLOGUE') return { statut: 'NATIONAL', libelle: 'Non homologué (national)', ton: 'neutre' };
  if (e.actif) return { statut: 'ACTIF', libelle: 'Actif', ton: 'succes' };
  if (e.statutLocal) return { statut: 'DESACTIVE', libelle: 'Désactivé', ton: 'attention' };
  return { statut: 'INACTIF', libelle: 'Non activé', ton: 'neutre' };
}

/**
 * Référentiel médical de l'assureur = CATALOGUE NATIONAL (ADR-009) : le contenu vient du catalogue national, l'assureur ne fait que
 * l'ACTIVER ou le DÉSACTIVER pour son organisation (informatique, médecin conseil, pharmacien conseil). Seuls les éléments activés sont
 * proposés à la saisie (ajout d'un acte, ordonnance). Désactiver est réversible et ne supprime rien.
 */
export function CatalogueActivationEcran({
  type,
  elements,
  peutGerer,
}: {
  type: TypeCatalogue;
  elements: ElementCatalogue[];
  /** Informatique, médecin conseil ou pharmacien conseil — l'API reste seule juge. */
  peutGerer: boolean;
}) {
  const t = TEXTES[type];
  const router = useRouter();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [resultat, setResultat] = useState<ResultatActivation | null>(null);
  const [erreurLigne, setErreurLigne] = useState<string | null>(null);

  const homologues = elements.filter((e) => e.statutNational === 'HOMOLOGUE');
  const actifs = homologues.filter((e) => e.actif).length;
  const aActiver = homologues.length - actifs;
  const rubriques = Array.from(new Set(elements.map((e) => e.rubrique).filter((r): r is string => !!r))).sort((a, b) => a.localeCompare(b, 'fr'));

  const apres = (r: ResultatActivation) => {
    setResultat(r);
    setSelection(new Set());
    router.refresh();
  };

  async function basculer(e: ElementCatalogue) {
    setErreurLigne(null);
    const r = e.actif ? await desactiverElement(type, e.id) : await activerElement(type, e.id);
    if (r.ok) apres(r);
    else setErreurLigne(`${e.libelle} : ${r.error}`);
  }

  const colonnes: ColonneTable<ElementCatalogue>[] = [
    { cle: 'code', entete: 'Code', triable: true, className: 'font-mono text-xs' },
    { cle: 'libelle', entete: type === 'actes' ? 'Libellé' : 'Médicament', triable: true },
    { cle: 'rubrique', entete: t.rubrique, valeur: (e) => e.rubrique ?? '', rendu: (e) => e.rubrique ?? '—' },
    { cle: 'detail', entete: type === 'actes' ? 'Nomenclature' : 'Dosage · forme', valeur: (e) => e.detail ?? '', rendu: (e) => e.detail ?? '—' },
    {
      cle: 'etat',
      entete: 'Dans votre référentiel',
      valeur: (e) => libelleEtat(e).libelle,
      rendu: (e) => {
        const s = libelleEtat(e);
        return <StatutBadge statut={s.statut} map={{ [s.statut]: s.ton }} libelles={{ [s.statut]: s.libelle }} />;
      },
    },
  ];

  /** Confirmation d'une action de masse — le serveur contrôle chaque élément et renvoie un résultat partiel. */
  const confirmerMasse = (
    declencheur: React.ReactNode,
    titre: string,
    description: string,
    lot: { ids?: string[]; tous?: boolean; actif: boolean },
  ) => (
    <FormulaireModal
      titre={titre}
      mode="center"
      description={description}
      declencheur={declencheur}
      libelleSoumettre="Confirmer"
      onSoumettre={async () => {
        const r = await activationMasse(type, lot);
        if (!r.ok) return { ok: false, error: r.error, erreurs: [] };
        apres(r);
        return { ok: true, message: r.message };
      }}
    >
      <p className="text-sm text-muted-foreground">
        {lot.actif
          ? `Les ${t.pluriel} activés sont proposés à la saisie (ajout d’un acte de soins, ordonnance).`
          : `Les ${t.pluriel} désactivés ne sont plus proposés à la saisie ; ce qui est déjà enregistré est conservé. Réversible.`}
      </p>
    </FormulaireModal>
  );

  return (
    <div className="space-y-4">
      <GrilleCartes>
        <CarteResume libelle={`${t.pluriel[0].toUpperCase()}${t.pluriel.slice(1)} du catalogue national`} valeur={homologues.length} />
        <CarteResume libelle="Actifs dans votre référentiel" valeur={actifs} />
        <CarteResume libelle="À activer" valeur={aActiver} />
      </GrilleCartes>

      {resultat && resultat.ok && (
        <Alerte ton={resultat.refuses.length ? 'avertissement' : 'succes'} titre="Terminé">
          <p>{resultat.message}</p>
          {resultat.refuses.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {resultat.refuses.slice(0, 10).map((r) => (
                <li key={r.id}>{r.raison}</li>
              ))}
            </ul>
          )}
        </Alerte>
      )}
      {erreurLigne && <Alerte ton="erreur">{erreurLigne}</Alerte>}

      <DataTable
        donnees={elements}
        cleLigne={(e) => e.id}
        parPage={15}
        recherche={{ placeholder: t.recherche, champs: ['code', 'libelle', 'rubrique', 'detail'] }}
        filtres={[
          {
            cle: 'etat',
            libelle: 'État',
            valeur: (row) => libelleEtat(row as ElementCatalogue).statut,
            options: [
              { valeur: 'ACTIF', libelle: 'Actifs' },
              { valeur: 'INACTIF', libelle: 'Non activés' },
              { valeur: 'DESACTIVE', libelle: 'Désactivés' },
            ],
          },
          ...(rubriques.length > 1
            ? [{ cle: 'rubrique', libelle: t.rubrique, options: rubriques.map((r) => ({ valeur: r, libelle: r })) }]
            : []),
        ]}
        colonnes={colonnes}
        actions={
          peutGerer ? (
            <span className="flex flex-wrap gap-2">
              {aActiver > 0 &&
                confirmerMasse(
                  <Button size="sm">{`Tout activer (${aActiver})`}</Button>,
                  `Activer tout le catalogue — ${aActiver} ${aActiver > 1 ? t.pluriel : t.singulier}`,
                  `Active d’un coup tous les ${t.pluriel} homologués du catalogue national qui ne sont pas encore actifs pour votre organisation.`,
                  { tous: true, actif: true },
                )}
              {actifs > 0 &&
                confirmerMasse(
                  <Button size="sm" variant="outline">{`Tout désactiver (${actifs})`}</Button>,
                  `Désactiver tout — ${actifs} ${actifs > 1 ? t.pluriel : t.singulier}`,
                  `Désactive tous les ${t.pluriel} actuellement actifs : plus aucun ne sera proposé à la saisie tant que vous n’en aurez pas réactivé.`,
                  { tous: true, actif: false },
                )}
            </span>
          ) : undefined
        }
        selection={
          peutGerer
            ? {
                ids: selection,
                onChange: setSelection,
                barre: (lignes) => {
                  const ids = lignes.map((l) => l.id);
                  return (
                    <>
                      {lignes.some((l) => l.statutNational === 'HOMOLOGUE' && !l.actif) &&
                        confirmerMasse(
                          <Button size="xs">{`Activer la sélection (${ids.length})`}</Button>,
                          `Activer ${ids.length} ${ids.length > 1 ? t.pluriel : t.singulier}`,
                          `Seuls les ${t.pluriel} homologués au catalogue national s’activent ; le détail des refus est affiché ensuite.`,
                          { ids, actif: true },
                        )}
                      {lignes.some((l) => l.actif) &&
                        confirmerMasse(
                          <Button size="xs" variant="outline">{`Désactiver la sélection (${ids.length})`}</Button>,
                          `Désactiver ${ids.length} ${ids.length > 1 ? t.pluriel : t.singulier}`,
                          `Les ${t.pluriel} sélectionnés cessent d’être proposés à la saisie.`,
                          { ids, actif: false },
                        )}
                    </>
                  );
                },
              }
            : undefined
        }
        actionLigne={
          peutGerer
            ? (e) =>
                e.statutNational !== 'HOMOLOGUE' ? null : (
                  <Button size="xs" variant={e.actif ? 'outline' : 'default'} onClick={() => void basculer(e)}>
                    {e.actif ? 'Désactiver' : e.statutLocal ? 'Réactiver' : 'Activer'}
                  </Button>
                )
            : undefined
        }
        vide={`Aucun ${t.singulier} dans le catalogue national.`}
      />
    </div>
  );
}
