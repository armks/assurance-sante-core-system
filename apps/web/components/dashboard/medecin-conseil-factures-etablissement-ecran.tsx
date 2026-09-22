'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ouvrirContestationActe } from '@/app/dashboard-assureur/medecin-conseil/contestations/actions';
import { verifierFactureMensuelleEtablissement } from '@/app/dashboard-assureur/medecin-conseil/factures-etablissement/actions';
import {
  ChampZone,
  DataTable,
  FormulaireModal,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface LigneFactureMensuelleEtablissement {
  id: string;
  acteDossierId: string;
  categorieActe: string;
  libelle: string;
  numeroTraitement: string;
  patient: string;
  montantReclame: string;
}
export interface FactureMensuelleEtablissementAVerifier {
  id: string;
  etablissement: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateSoumission: string;
  lignes: LigneFactureMensuelleEtablissement[];
}

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const moisFr = (d: string) =>
  new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

function ContesterLigne({
  ligne,
  onSucces,
}: {
  ligne: LigneFactureMensuelleEtablissement;
  onSucces: (m: string) => void;
}) {
  return (
    <FormulaireModal
      titre="Ouvrir une contestation"
      mode="center"
      description={`${ligne.libelle} — ${ligne.numeroTraitement} (${ligne.patient}).`}
      declencheur={<Button size="xs" variant="destructive">Contester</Button>}
      libelleSoumettre="Ouvrir la contestation"
      onSoumettre={async (fd) => ouvrirContestationActe(ligne.acteDossierId, String(fd.get('motif') ?? ''))}
      onSucces={() => onSucces('Contestation ouverte — traitez-la depuis « Contestations » avant de revérifier cette facture.')}
    >
      <ChampZone
        name="motif"
        label="Motif de la contestation"
        required
        minLength={5}
        maxLength={1000}
        rows={4}
        aide="Tracé dans l'audit — expliquez précisément ce qui est contesté."
      />
    </FormulaireModal>
  );
}

export function MedecinConseilFacturesEtablissementEcran({
  factures,
}: {
  factures: FactureMensuelleEtablissementAVerifier[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  async function verifier(id: string, decision: 'VALIDEE' | 'A_CORRIGER') {
    const r = await verifierFactureMensuelleEtablissement(id, decision);
    if (r.ok) succes(r.message ?? 'Fait.');
    else setMessage(`Erreur : ${r.error}`);
  }

  const factureDetail = factures.find((f) => f.id === detailId) ?? null;

  const colonnes: ColonneTable<FactureMensuelleEtablissementAVerifier>[] = [
    { cle: 'etablissement', entete: 'Établissement', triable: true },
    {
      cle: 'periode',
      entete: 'Période',
      triable: true,
      valeur: (f) => f.periode,
      rendu: (f) => moisFr(f.periode),
    },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (f) => Number(f.montantTotal),
      rendu: (f) => montant(f.montantTotal),
    },
    {
      cle: 'dateSoumission',
      entete: 'Soumise le',
      triable: true,
      valeur: (f) => f.dateSoumission,
      rendu: (f) => dateFr(f.dateSoumission),
    },
  ];

  return (
    <div className="space-y-8">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Factures établissements à vérifier</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={factures}
            cleLigne={(f) => f.id}
            parPage={10}
            colonnes={colonnes}
            actionLigne={(f) => (
              <div className="flex items-center gap-1">
                <Button size="xs" variant="ghost" onClick={() => setDetailId(f.id === detailId ? null : f.id)}>
                  {f.id === detailId ? 'Masquer' : 'Détail'}
                </Button>
                <Button size="xs" onClick={() => verifier(f.id, 'VALIDEE')}>
                  Valider
                </Button>
                <Button size="xs" variant="outline" onClick={() => verifier(f.id, 'A_CORRIGER')}>
                  À corriger
                </Button>
              </div>
            )}
            vide="Aucune facture établissement en attente de vérification."
          />
        </CardContent>
      </Card>

      {factureDetail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Détail — {factureDetail.etablissement} ({moisFr(factureDetail.periode)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5">Patient</th>
                  <th className="py-1.5">Dossier</th>
                  <th className="py-1.5">Acte</th>
                  <th className="py-1.5 text-right">Montant</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {factureDetail.lignes.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-1.5">{l.patient}</td>
                    <td className="py-1.5">{l.numeroTraitement}</td>
                    <td className="py-1.5">{l.libelle}</td>
                    <td className="py-1.5 text-right">{montant(l.montantReclame)}</td>
                    <td className="py-1.5 text-right">
                      <ContesterLigne ligne={l} onSucces={succes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {factureDetail.lignes.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucune ligne incluse.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
