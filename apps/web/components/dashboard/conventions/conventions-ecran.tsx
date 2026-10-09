'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { creerConvention } from '@/app/dashboard-assureur/conventions-actions';
import {
  Alerte,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import {
  LIBELLE_POLITIQUE_DEPASSEMENT,
  LIBELLE_STATUT_CONVENTION,
  TON_STATUT_CONVENTION,
  type ConventionResume,
  type IndicateursConventions,
} from '@/lib/conventions';
import { dateFr } from '@/lib/format';

/**
 * Liste des conventions — partagée par l'assurance informatique (saisie), le médecin conseil et la direction
 * (validation). `base` = racine de l'espace, `peutSaisir` = droit de créer (assurance informatique).
 */
export function ConventionsEcran({
  conventions,
  etablissements,
  indicateurs,
  base,
  peutSaisir,
}: {
  conventions: ConventionResume[];
  etablissements: { id: string; nom: string; code: string }[];
  indicateurs: IndicateursConventions | null;
  base: string;
  peutSaisir: boolean;
}) {
  const router = useRouter();
  const [voirArchivees, setVoirArchivees] = useState(false);
  const archivees = conventions.filter((c) => c.statut === 'ARCHIVEE').length;
  const visibles = voirArchivees ? conventions : conventions.filter((c) => c.statut !== 'ARCHIVEE');

  const colonnes: ColonneTable<ConventionResume>[] = [
    {
      cle: 'numero',
      entete: 'Convention',
      triable: true,
      valeur: (c) => c.numero,
      rendu: (c) => (
        <span>
          <span className="font-medium">{c.numero}</span>
          <span className="block text-xs text-muted-foreground">
            version {c.version}
            {c.historique ? ' · historique (migration des anciens tarifs)' : ''}
          </span>
        </span>
      ),
    },
    { cle: 'etablissement', entete: 'Établissement', triable: true, valeur: (c) => c.etablissement.nom, rendu: (c) => c.etablissement.nom },
    {
      cle: 'periode',
      entete: 'Période',
      valeur: (c) => c.dateDebut,
      rendu: (c) => `${dateFr(c.dateDebut)} → ${c.dateFin ? dateFr(c.dateFin) : 'sans fin'}`,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} map={TON_STATUT_CONVENTION} libelles={LIBELLE_STATUT_CONVENTION} />,
    },
    {
      cle: 'contenu',
      entete: 'Contenu',
      rendu: (c) => (
        <span className="text-xs text-muted-foreground">
          {c.nbValeurs} valeur{c.nbValeurs > 1 ? 's' : ''} · {c.nbActes} exception{c.nbActes > 1 ? 's' : ''}
          {c.aDocument ? ' · document joint' : ' · sans document'}
        </span>
      ),
    },
    {
      cle: 'politique',
      entete: 'Dépassement',
      rendu: (c) => <span className="text-xs">{LIBELLE_POLITIQUE_DEPASSEMENT[c.politiqueDepassement]}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {indicateurs && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Établissements sans convention validée</p>
            <p className={`text-2xl font-semibold ${indicateurs.sansConventionValidee > 0 ? 'text-amber-600' : ''}`}>
              {indicateurs.sansConventionValidee}
              <span className="text-sm font-normal text-muted-foreground"> / {indicateurs.etablissementsActifs} actifs</span>
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Conventions à valider</p>
            <p className="text-2xl font-semibold">{indicateurs.conventionsAValider}</p>
          </div>
        </div>
      )}
      {indicateurs && indicateurs.etablissementsSansConvention.length > 0 && (
        <Alerte ton="avertissement" titre="Sans convention validée en vigueur">
          {indicateurs.etablissementsSansConvention.map((e) => e.nom).join(' · ')}
        </Alerte>
      )}
      {archivees > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={voirArchivees} onChange={(e) => setVoirArchivees(e.target.checked)} />
          Archivées ({archivees})
        </label>
      )}
      <DataTable
        donnees={visibles}
        cleLigne={(c) => c.id}
        parPage={15}
        recherche={{ placeholder: 'Numéro, établissement…', champs: ['numero', 'etablissement.nom'] }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_STATUT_CONVENTION).map(([valeur, libelle]) => ({ valeur, libelle })),
          },
        ]}
        colonnes={colonnes}
        actions={
          peutSaisir ? (
            <FormulaireModal
              titre="Nouvelle convention"
              description="La convention est créée « proposée » : saisissez les valeurs, joignez le document signé, puis elle est validée par le médecin conseil ou la direction."
              declencheurLabel="Nouvelle convention"
              libelleSoumettre="Créer la convention"
              onSoumettre={async (fd) => {
                const r = await creerConvention({
                  etablissementId: String(fd.get('etablissementId') ?? ''),
                  numero: String(fd.get('numero') ?? ''),
                  dateDebut: String(fd.get('dateDebut') ?? ''),
                  dateFin: String(fd.get('dateFin') ?? '') || undefined,
                  politiqueDepassement: String(fd.get('politiqueDepassement') ?? 'PATIENT'),
                });
                if (r.ok && r.id) router.push(`${base}/conventions/${r.id}`);
                return r;
              }}
              onSucces={() => router.refresh()}
            >
              <ChampSelect
                name="etablissementId"
                label="Établissement"
                required
                placeholder="Choisir…"
                defaultValue=""
                options={etablissements.map((e) => ({ valeur: e.id, libelle: `${e.nom} (${e.code})` }))}
              />
              <ChampTexte name="numero" label="Numéro de la convention" required placeholder="CONV-2026-001" />
              <ChampTexte name="dateDebut" label="Date d’effet" type="date" required />
              <ChampTexte name="dateFin" label="Date de fin (facultative)" type="date" />
              <ChampSelect
                name="politiqueDepassement"
                label="Dépassement (prix affiché supérieur au tarif reconnu)"
                defaultValue="PATIENT"
                options={Object.entries(LIBELLE_POLITIQUE_DEPASSEMENT).map(([valeur, libelle]) => ({ valeur, libelle }))}
              />
            </FormulaireModal>
          ) : undefined
        }
        actionLigne={(c) => (
          <Button asChild size="xs" variant="ghost">
            <Link href={`${base}/conventions/${c.id}`}>Ouvrir</Link>
          </Button>
        )}
        vide="Aucune convention pour l’instant."
      />
    </div>
  );
}
