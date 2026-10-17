'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { renouvelerCodeFacturation } from '@/app/dashboard-centre-medical/mes-factures-actions';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  StatutBadge,
  type ColonneTable,
  type FiltreSelect,
} from '@/components/dashboard/patterns';
import {
  LIBELLE_STATUT_FACTURE_DOSSIER,
  TON_STATUT_FACTURE_DOSSIER,
} from '@/lib/dossier-soins';
import { dateFr, montantF } from '@/lib/format';
import { LIBELLE_REGLE_ORIGINE, libelleDe } from '@/lib/tarifs';

export interface FactureDossierEtablissement {
  id: string;
  numeroTraitement: string;
  societeCliente: string;
  patient: string;
  statut: string;
  montantTotal: string;
  montantAssurance: string;
  montantPatient: string;
  createdAt: string;
  dateReglement: string | null;
  /** Règles d'origine des tarifs appliqués aux lignes (trace figée) ; facture complémentaire / tarif en examen (lot barème 6). */
  reglesOrigine?: string[];
  complementaire?: boolean;
  tarifEnExamen?: boolean;
  /** Code de facturation en attente de validation par le patient (jamais le code lui-même) ; `codeExpire` : à renouveler. */
  codeAValider?: boolean;
  codeExpire?: boolean;
}

/** « Nouveau code » : remplace le code de facturation de la facture (24 h), surtout quand il a expiré. */
function BoutonNouveauCode({ facture }: { facture: FactureDossierEtablissement }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  if (!facture.codeAValider) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="xs"
        variant={facture.codeExpire ? 'default' : 'ghost'}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await renouvelerCodeFacturation(facture.id);
            setMessage({ ok: res.ok, texte: res.ok ? (res.message ?? 'Code renouvelé.') : res.error });
            if (res.ok) router.refresh();
          })
        }
      >
        {facture.codeExpire ? 'Code expiré — nouveau code' : 'Nouveau code'}
      </Button>
      {message && <span className={message.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>{message.texte}</span>}
    </div>
  );
}

const LIBELLE_STATUT = LIBELLE_STATUT_FACTURE_DOSSIER;
const TON_STATUT = TON_STATUT_FACTURE_DOSSIER;

const periodeCle = (d: string) => d.slice(0, 7); // 'YYYY-MM'
const periodeLibelle = (cle: string) =>
  new Date(`${cle}-01T00:00:00Z`).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

function optionsUniques(valeurs: string[]): { valeur: string; libelle: string }[] {
  return [...new Set(valeurs)]
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((v) => ({ valeur: v, libelle: v }));
}

export function MesFacturesEcran({ factures }: { factures: FactureDossierEtablissement[] }) {
  const colonnes: ColonneTable<FactureDossierEtablissement>[] = [
    { cle: 'numeroTraitement', entete: 'Dossier', triable: true },
    { cle: 'societeCliente', entete: 'Société cliente', triable: true },
    { cle: 'patient', entete: 'Adhérent / bénéficiaire', triable: true },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (f) => Number(f.montantTotal),
      rendu: (f) => montantF(f.montantTotal),
    },
    {
      cle: 'tarif',
      entete: 'Tarif appliqué',
      rendu: (f) => (
        <span className="block text-xs" data-testid="tarif-applique">
          {f.complementaire
            ? 'Facture complémentaire (part patient après décision sur le tarif)'
            : f.reglesOrigine && f.reglesOrigine.length > 0
              ? f.reglesOrigine.map((r) => libelleDe(LIBELLE_REGLE_ORIGINE, r)).join(' · ')
              : '—'}
          {f.tarifEnExamen && <span className="mt-1 block text-amber-700 dark:text-amber-400">Tarif en cours d’examen</span>}
        </span>
      ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (f) => <StatutBadge statut={f.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />,
    },
    {
      cle: 'createdAt',
      entete: 'Émise le',
      triable: true,
      valeur: (f) => f.createdAt,
      rendu: (f) => dateFr(f.createdAt),
    },
    {
      cle: 'dateReglement',
      entete: 'Réglée le',
      triable: true,
      valeur: (f) => f.dateReglement ?? '',
      rendu: (f) => (f.dateReglement ? dateFr(f.dateReglement) : '—'),
    },
  ];

  const filtres: FiltreSelect[] = [
    {
      cle: 'societeCliente',
      libelle: 'Société cliente',
      options: optionsUniques(factures.map((f) => f.societeCliente)),
    },
    {
      cle: 'patient',
      libelle: 'Adhérent / famille',
      options: optionsUniques(factures.map((f) => f.patient)),
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      options: optionsUniques(factures.map((f) => f.statut)).map((o) => ({
        ...o,
        libelle: LIBELLE_STATUT[o.valeur] ?? o.libelle,
      })),
    },
    {
      cle: 'periode',
      libelle: 'Période',
      valeur: (row) => periodeCle((row as FactureDossierEtablissement).createdAt),
      options: optionsUniques(factures.map((f) => periodeCle(f.createdAt))).map((o) => ({
        valeur: o.valeur,
        libelle: periodeLibelle(o.valeur),
      })),
    },
  ];

  return (
    <DataTable
      donnees={factures}
      cleLigne={(f) => f.id}
      parPage={15}
      recherche={{
        placeholder: 'Dossier, société, adhérent…',
        champs: ['numeroTraitement', 'societeCliente', 'patient'],
      }}
      filtres={filtres}
      colonnes={colonnes}
      actionLigne={(f) => <BoutonNouveauCode facture={f} />}
      vide="Aucune facture pour l’instant."
    />
  );
}
