'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { validerFactureMensuelle } from '@/app/dashboard-assureur/pharmacien-conseil/factures-mensuelles/actions';
import { DataTable, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface LigneFactureMensuelle {
  id: string;
  denominationMedicament: string;
  quantite: number;
  montantAssurance: string;
}
export interface FactureMensuelleAValider {
  id: string;
  pharmacie: string;
  periode: string;
  statut: string;
  montantTotal: string;
  dateSoumission: string;
  lignes: LigneFactureMensuelle[];
}

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const moisFr = (d: string) =>
  new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

export function PharmacienConseilFacturesMensuellesEcran({
  factures,
}: {
  factures: FactureMensuelleAValider[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function valider(id: string) {
    const r = await validerFactureMensuelle(id);
    if (r.ok) {
      setMessage(r.message ?? 'Validée.');
      router.refresh();
    } else {
      setMessage(`Erreur : ${r.error}`);
    }
  }

  const factureDetail = factures.find((f) => f.id === detailId) ?? null;

  const colonnes: ColonneTable<FactureMensuelleAValider>[] = [
    { cle: 'pharmacie', entete: 'Pharmacie', triable: true },
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
          <CardTitle className="text-base">Factures mensuelles à valider</CardTitle>
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
                <Button size="xs" onClick={() => valider(f.id)}>
                  Valider
                </Button>
              </div>
            )}
            vide="Aucune facture mensuelle en attente de validation."
          />
        </CardContent>
      </Card>

      {factureDetail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Détail — {factureDetail.pharmacie} ({moisFr(factureDetail.periode)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5">Médicament</th>
                  <th className="py-1.5 text-right">Quantité</th>
                  <th className="py-1.5 text-right">Part assurance</th>
                </tr>
              </thead>
              <tbody>
                {factureDetail.lignes.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-1.5">{l.denominationMedicament}</td>
                    <td className="py-1.5 text-right">{l.quantite}</td>
                    <td className="py-1.5 text-right">{montant(l.montantAssurance)}</td>
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
