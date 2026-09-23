'use client';

import { useState, useTransition } from 'react';

import {
  consoliderFacturationSociete,
  listerAdherentsPourFacturation,
  type AdherentPourFacturation,
} from '@/app/dashboard-assureur/comptable/facturation-societes/actions';
import { DataTable, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface Souscripteur {
  id: string;
  nom: string;
}

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const moisFr = (aaaaMm: string) =>
  new Date(`${aaaaMm}-01T00:00:00Z`).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

function moisCourantISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function FacturationSocietesEcran({
  souscripteurs,
  cible,
}: {
  souscripteurs: Souscripteur[];
  cible: string;
}) {
  const [souscripteurId, setSouscripteurId] = useState('');
  const [mois, setMois] = useState(moisCourantISO());
  const [adherents, setAdherents] = useState<AdherentPourFacturation[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [pending, start] = useTransition();

  const periode = `${mois}-01`;

  function charger() {
    if (!souscripteurId) return;
    setMessage(null);
    start(async () => {
      const r = await listerAdherentsPourFacturation(souscripteurId, periode);
      if (r.ok) setAdherents(r.adherents);
      else {
        setAdherents(null);
        setMessage({ ok: false, texte: r.error });
      }
    });
  }

  function consolider() {
    if (!souscripteurId) return;
    start(async () => {
      const r = await consoliderFacturationSociete(souscripteurId, periode, cible);
      if (r.ok) {
        setMessage({
          ok: true,
          texte: `Facture société consolidée : ${Number(r.montantDu).toLocaleString('fr-FR')} F pour ${r.nbAdherentsFactures} adhérent(s)${
            r.nbAdherentsReportes > 0 ? ` (${r.nbAdherentsReportes} reporté(s) au mois suivant)` : ''
          }.`,
        });
        charger();
      } else {
        setMessage({ ok: false, texte: r.error });
      }
    });
  }

  const colonnes: ColonneTable<AdherentPourFacturation>[] = [
    { cle: 'numeroAdherent', entete: 'N° adhérent', triable: true },
    {
      cle: 'nom',
      entete: 'Nom / prénom',
      valeur: (a) => `${a.nom} ${a.prenom}`,
      rendu: (a) => `${a.nom} ${a.prenom}`,
    },
    { cle: 'age', entete: 'Âge', aligneDroite: true, triable: true },
    {
      cle: 'dateValidation',
      entete: 'Validé le',
      triable: true,
      valeur: (a) => a.dateValidation,
      rendu: (a) => dateFr(a.dateValidation),
    },
    { cle: 'nbBeneficiaires', entete: 'Bénéficiaires', aligneDroite: true },
  ];

  return (
    <div className="space-y-6">
      {message && (
        <p
          className={
            message.ok
              ? 'rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
              : 'rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive'
          }
        >
          {message.texte}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sélection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Société cliente
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
              value={souscripteurId}
              onChange={(e) => {
                setSouscripteurId(e.target.value);
                setAdherents(null);
              }}
            >
              <option value="">Choisir…</option>
              {souscripteurs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mois de facturation
            <input
              type="month"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
              value={mois}
              onChange={(e) => {
                setMois(e.target.value);
                setAdherents(null);
              }}
            />
          </label>
          <Button size="sm" disabled={!souscripteurId || pending} onClick={charger}>
            Afficher les adhérents pour facturation
          </Button>
        </CardContent>
      </Card>

      {adherents && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Adhérents pour facturation — {moisFr(mois)} ({adherents.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Adhérents principaux validés par ASSUREUR_EXPLOITATION avant le 1er du mois — un
              adhérent validé après cette date apparaît automatiquement le mois suivant.
            </p>
            <DataTable
              donnees={adherents}
              cleLigne={(a) => a.id}
              parPage={15}
              colonnes={colonnes}
              vide="Aucun adhérent principal validé avant la coupure pour ce mois."
            />
            <Button disabled={pending || adherents.length === 0} onClick={consolider}>
              Consolider et valider la facture société
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
