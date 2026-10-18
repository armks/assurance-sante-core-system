'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { enregistrerParametresImpression } from '@/app/parametres-impression-actions';
import type { ParametresImpression } from '@/app/parametres-impression-types';
import { ChampCheckbox, ChampSelect, ChampTexte, ChampZone } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const IMPRIMANTES = [
  { valeur: 'THERMIQUE_80', libelle: 'Imprimante thermique 80 mm (ticket de caisse standard)' },
  { valeur: 'THERMIQUE_58', libelle: 'Imprimante thermique 58 mm (petit ticket)' },
  { valeur: 'A4', libelle: 'Imprimante A4 (reçu pleine page)' },
];

/**
 * Paramétrage de l'impression des reçus de caisse d'un établissement sanitaire ou d'une pharmacie : type d'imprimante (ticket
 * thermique ou A4), en-tête, pied de page, identifiant fiscal et présence du détail des lignes sur le reçu.
 */
export function ParametresImpressionEcran({ parametres, racine }: { parametres: ParametresImpression; racine: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Imprimante des reçus de caisse</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          action={(fd) =>
            start(async () => {
              setErreur(null);
              setMessage(null);
              const r = await enregistrerParametresImpression(
                {
                  typeImprimante: String(fd.get('typeImprimante') ?? 'A4'),
                  enTete: String(fd.get('enTete') ?? ''),
                  piedPage: String(fd.get('piedPage') ?? ''),
                  identifiantFiscal: String(fd.get('identifiantFiscal') ?? ''),
                  afficherDetail: fd.get('afficherDetail') === 'on',
                },
                racine,
              );
              if (r.ok) {
                setMessage(r.message ?? 'Paramètres enregistrés.');
                router.refresh();
              } else {
                setErreur([r.error, ...(r.erreurs ?? [])].join(' '));
              }
            })
          }
        >
          {erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{erreur}</p>}
          {message && <p role="status" className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">{message}</p>}
          <ChampSelect
            name="typeImprimante"
            label="Type d’imprimante"
            required
            defaultValue={parametres.typeImprimante}
            options={IMPRIMANTES}
            aide="Le reçu de caisse est mis en page à la largeur du papier : ticket thermique (hauteur ajustée au contenu) ou page A4."
          />
          <ChampZone name="enTete" label="En-tête du reçu" defaultValue={parametres.enTete ?? ''} maxLength={300} aide="Facultatif : slogan, mention d’agrément… (300 caractères)." />
          <ChampTexte name="identifiantFiscal" label="Identifiant fiscal / registre de commerce" defaultValue={parametres.identifiantFiscal ?? ''} maxLength={60} aide="Facultatif : imprimé sous le nom de l’établissement." />
          <ChampZone name="piedPage" label="Pied de page du reçu" defaultValue={parametres.piedPage ?? ''} maxLength={300} aide="Facultatif : horaires, message de remerciement… (300 caractères)." />
          <ChampCheckbox name="afficherDetail" label="Imprimer le détail des actes / médicaments sur le reçu" defaultChecked={parametres.afficherDetail} />
          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
