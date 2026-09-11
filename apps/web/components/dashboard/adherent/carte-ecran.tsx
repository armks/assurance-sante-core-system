'use client';

import { useState, useTransition } from 'react';

import { genererMaCarte } from '@/app/dashboard-adherent/carte/actions';
import type { CarteGeneree } from '@/app/dashboard-adherent/carte/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function CarteEcran({ adherentId }: { adherentId: string }) {
  const [pending, start] = useTransition();
  const [carte, setCarte] = useState<CarteGeneree | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErreur(null);
            const res = await genererMaCarte(adherentId);
            if (res.ok) setCarte(res.carte);
            else setErreur(res.error);
          })
        }
      >
        {pending ? 'Génération…' : 'Générer ma carte'}
      </Button>

      {erreur && <p className="text-sm text-destructive">{erreur}</p>}

      {carte && (
        <Card className="max-w-sm">
          <CardContent className="space-y-4 pt-6 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URI, pas d'optimisation Next.js utile */}
            <img
              src={carte.qrCode}
              alt={`QR code de la carte ${carte.numeroCarte}`}
              width={160}
              height={160}
              className="mx-auto"
            />
            <p className="font-mono text-sm text-muted-foreground">{carte.numeroCarte}</p>
            <Button asChild variant="outline" className="w-full">
              <a href={carte.url} target="_blank" rel="noreferrer">
                Ouvrir / télécharger le PDF
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Lien valable {Math.round(carte.expiresIn / 60)} minutes.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
