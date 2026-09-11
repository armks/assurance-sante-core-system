'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { marquerDispense, validerCode } from '@/app/dashboard-pharmacie/actions';
import type {
  CodeOrdonnancePharmacie,
  LigneOrdonnance,
} from '@/app/dashboard-pharmacie/types';
import {
  CarteResume,
  ChampSelect,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const LIBELLE_STATUT: Record<string, string> = {
  PRESENTE_PHARMACIE: 'En attente de dispensation',
  UTILISE_PARTIEL: 'Dispensée partiellement',
  UTILISE_COMPLET: 'Dispensée entièrement',
  EXPIRE: 'Expirée',
  ANNULE: 'Annulée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  PRESENTE_PHARMACIE: 'attention',
  UTILISE_PARTIEL: 'attention',
  UTILISE_COMPLET: 'succes',
  EXPIRE: 'danger',
  ANNULE: 'danger',
};
const STATUTS_EN_ATTENTE = ['PRESENTE_PHARMACIE', 'UTILISE_PARTIEL'];

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');
const ligneFr = (l: LigneOrdonnance) =>
  `${l.medicament}${l.dosage ? ` (${l.dosage})` : ''} — ${l.posologie}`;

export function DispensationEcran({
  pharmacieId,
  codes,
  cible,
}: {
  pharmacieId: string;
  codes: CodeOrdonnancePharmacie[];
  cible: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [revele, setRevele] = useState<CodeOrdonnancePharmacie['ordonnance'] | null>(null);

  const enAttente = codes.filter((c) => STATUTS_EN_ATTENTE.includes(c.statut));
  const dispensees = codes.filter((c) => c.statut === 'UTILISE_COMPLET');

  const colonnes: ColonneTable<CodeOrdonnancePharmacie>[] = [
    {
      cle: 'numeroTraitement',
      entete: 'Dossier',
      rendu: (c) => c.ordonnance?.numeroTraitement ?? '—',
    },
    {
      cle: 'medicaments',
      entete: 'Médicaments',
      rendu: (c) => (
        <ul className="list-disc space-y-0.5 pl-4 text-xs">
          {(c.ordonnance?.lignes ?? []).map((l, i) => (
            <li key={i}>{ligneFr(l)}</li>
          ))}
        </ul>
      ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'dateEmission',
      entete: 'Prise en charge le',
      triable: true,
      valeur: (c) => c.dateEmission,
      rendu: (c) => dateHeureFr(c.dateEmission),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="En attente de dispensation" valeur={enAttente.length} />
        <CarteResume libelle="Dispensées entièrement" valeur={dispensees.length} />
        <CarteResume libelle="Total pris en charge" valeur={codes.length} />
      </GrilleCartes>

      {revele && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-muted-foreground">
              Ordonnance {revele?.numeroTraitement} — contenu révélé
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {(revele?.lignes ?? []).map((l, i) => (
                <li key={i}>{ligneFr(l)}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <FormulaireModal
          titre="Valider un code d’ordonnance"
          description="Saisissez le code communiqué par le patient. Le contenu de l’ordonnance s’affiche si le code est valide."
          declencheurLabel="Valider un code"
          libelleSoumettre="Valider"
          onSoumettre={async (fd) => {
            const code = String(fd.get('code') ?? '').toUpperCase();
            const res = await validerCode(code, pharmacieId, cible);
            if (res.ok) setRevele(res.ordonnance ?? null);
            return res;
          }}
          onSucces={() => router.refresh()}
        >
          <ChampTexte
            name="code"
            label="Code d’ordonnance"
            required
            placeholder="Ex. AB23CD45"
            maxLength={8}
            className="uppercase"
          />
        </FormulaireModal>
      </div>

      <DataTable
        donnees={codes}
        cleLigne={(c) => c.id}
        parPage={10}
        colonnes={colonnes}
        actionLigne={(c) =>
          STATUTS_EN_ATTENTE.includes(c.statut) ? (
            <FormulaireModal
              titre="Marquer la dispensation"
              mode="center"
              declencheur={
                <Button size="xs" disabled={pending}>
                  Marquer comme dispensée
                </Button>
              }
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) => {
                const type = String(fd.get('type') ?? 'COMPLETE') as 'PARTIELLE' | 'COMPLETE';
                const commentaire = String(fd.get('commentaire') ?? '') || undefined;
                return marquerDispense(c.id, { type, commentaire }, cible);
              }}
              onSucces={() => router.refresh()}
            >
              <ChampSelect
                name="type"
                label="Type de dispensation"
                required
                options={[
                  { valeur: 'COMPLETE', libelle: 'Complète' },
                  { valeur: 'PARTIELLE', libelle: 'Partielle' },
                ]}
              />
              <ChampZone name="commentaire" label="Commentaire (optionnel)" />
            </FormulaireModal>
          ) : null
        }
        vide="Aucun code d’ordonnance pris en charge par votre pharmacie pour l’instant."
      />
    </div>
  );
}
