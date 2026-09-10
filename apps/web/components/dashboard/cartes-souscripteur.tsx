'use client';

import { useState, useTransition } from 'react';
import { IdCard } from 'lucide-react';

import { genererCartesSouscripteur } from '@/app/dashboard-assureur/informatique/souscripteurs/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Vue détail souscripteur — génération des cartes de membre (PROMPT 13).
 * Un clic → PDF multi-pages de toutes les cartes des adhérents ACTIFS, ouvert
 * dans un nouvel onglet via l'URL signée renvoyée par l'API.
 */
export function CartesSouscripteur({
  souscripteurId,
}: {
  souscripteurId: string;
}) {
  const [enCours, demarrer] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function generer() {
    setMessage(null);
    setErreur(null);
    demarrer(async () => {
      const r = await genererCartesSouscripteur(souscripteurId);
      if (!r.ok) {
        setErreur(r.error);
        return;
      }
      setMessage(
        `${r.nombreCartes} carte${r.nombreCartes > 1 ? 's' : ''} générée${
          r.nombreCartes > 1 ? 's' : ''
        }. Le PDF s'ouvre dans un nouvel onglet (lien valable ${Math.round(
          r.expiresIn / 60,
        )} min).`,
      );
      window.open(r.url, '_blank', 'noopener,noreferrer');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IdCard className="size-4" />
          Cartes de membre
        </CardTitle>
        <CardDescription>
          Génère un PDF regroupant les cartes (nom, n° de carte, formule,
          validité, QR code) de tous les adhérents actifs de ce souscripteur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={generer} disabled={enCours}>
          {enCours ? 'Génération…' : 'Générer les cartes'}
        </Button>
        {message && <p className="text-sm text-emerald-600">{message}</p>}
        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
      </CardContent>
    </Card>
  );
}
