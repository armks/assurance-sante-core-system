'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  annulerCode,
  demanderCode,
} from '@/app/dashboard-adherent/consultation/actions';
import type { CodeConsultationGenere } from '@/app/dashboard-adherent/consultation/types';
import {
  ChampSelect,
  DataTable,
  FiltresServeur,
  FormulaireModal,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface EtablissementOption {
  id: string;
  nom: string;
  ville: string | null;
}

export interface CodeConsultation {
  id: string;
  code: string;
  statut: string;
  etablissementId: string;
  dateEmission: string;
  dateExpiration: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EMIS: 'Émis',
  CONFIRME_PATIENT: 'Confirmé',
  UTILISE_ETABLISSEMENT: 'Utilisé',
  EXPIRE: 'Expiré',
  ANNULE: 'Annulé',
};

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');

export function ConsultationEcran({
  etablissements,
  policeId,
  codes,
}: {
  etablissements: EtablissementOption[];
  policeId: string | null;
  /** Page renvoyée par l'API (pagination, statut et période côté serveur). */
  codes: PageServeur<CodeConsultation>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dernierCode, setDernierCode] = useState<CodeConsultationGenere | null>(null);

  const nomEtablissement = (id: string) =>
    etablissements.find((e) => e.id === id)?.nom ?? '—';

  const colonnes: ColonneTable<CodeConsultation>[] = [
    {
      cle: 'etablissementId',
      entete: 'Établissement',
      rendu: (c) => nomEtablissement(c.etablissementId),
    },
    { cle: 'code', entete: 'Code' },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'dateEmission',
      entete: 'Émis le',
      rendu: (c) => dateHeureFr(c.dateEmission),
    },
    {
      cle: 'dateExpiration',
      entete: 'Expire le',
      valeur: (c) => c.dateExpiration,
      rendu: (c) => dateHeureFr(c.dateExpiration),
    },
  ];

  return (
    <div className="space-y-6">
      {dernierCode && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-muted-foreground">
              Code à transmettre ORALEMENT à l’accueil de {dernierCode.etablissement.nom}
            </p>
            <p className="font-mono text-4xl font-bold tracking-widest">{dernierCode.code}</p>
            <p className="text-xs text-muted-foreground">
              Valide 48 heures, à usage unique. Ne le communiquez à personne d’autre que
              l’accueil de l’établissement.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <FormulaireModal
          titre="Demander un code de consultation"
          description="Choisissez l’établissement où vous vous rendez. Le code s’affiche ensuite à l’écran."
          declencheurLabel="Demander un code"
          libelleSoumettre="Générer le code"
          onSoumettre={async (fd) => {
            if (!policeId) {
              return { ok: false, error: "Votre compte n'est rattaché à aucune police active." };
            }
            const etablissementId = String(fd.get('etablissementId') ?? '');
            const res = await demanderCode({ etablissementId, policeId });
            if (res.ok) setDernierCode(res.code ?? null);
            return res;
          }}
          onSucces={() => router.refresh()}
        >
          <ChampSelect
            name="etablissementId"
            label="Établissement"
            required
            placeholder="Choisir un établissement…"
            options={etablissements.map((e) => ({
              valeur: e.id,
              libelle: e.ville ? `${e.nom} — ${e.ville}` : e.nom,
            }))}
          />
        </FormulaireModal>
      </div>

      <FiltresServeur
        periode
        libellePeriode="Émis"
        selects={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })),
          },
        ]}
      />
      <DataTable
        donnees={codes.items}
        cleLigne={(c) => c.id}
        parPage={0}
        piedMasque
        colonnes={colonnes}
        actionLigne={(c) =>
          c.statut === 'EMIS' ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await annulerCode(c.id);
                  router.refresh();
                })
              }
            >
              Annuler
            </Button>
          ) : null
        }
        vide="Aucun code de consultation ne correspond à ces critères."
      />
      <PaginationServeur page={codes.page} pages={codes.pages} total={codes.total} limite={codes.limite} />
    </div>
  );
}
