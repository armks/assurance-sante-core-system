'use client';

import { useState, useTransition } from 'react';
import { IdCard } from 'lucide-react';

import {
  genererCarteAdherent,
  genererCarteBeneficiaire,
} from '@/app/dashboard-assureur/adherents-actions';
import { Button } from '@/components/ui/button';

/**
 * Bouton « Générer la carte » — adhérent ou bénéficiaire. Indisponible (et
 * signalé) si le membre n’est pas ACTIF : l’API renvoie alors un 409, mais on
 * retire aussi l’action visuellement.
 */
export function CarteBouton({
  adherentId,
  beneficiaireId,
  actif,
  raisonIndispo,
}: {
  adherentId: string;
  beneficiaireId?: string;
  actif: boolean;
  raisonIndispo: string;
}) {
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [carte, setCarte] = useState<{ url: string; qrCode: string } | null>(
    null,
  );

  if (!actif) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Carte indisponible — {raisonIndispo}.
      </p>
    );
  }

  function generer() {
    setErreur(null);
    start(async () => {
      const r = beneficiaireId
        ? await genererCarteBeneficiaire(adherentId, beneficiaireId)
        : await genererCarteAdherent(adherentId);
      if (!r.ok) {
        setErreur(r.error);
        return;
      }
      setCarte({ url: r.url, qrCode: r.qrCode });
      window.open(r.url, '_blank', 'noopener,noreferrer');
    });
  }

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={generer} disabled={pending}>
        <IdCard className="size-4" />
        {pending ? 'Génération…' : 'Générer la carte'}
      </Button>
      {erreur && <p className="text-sm text-destructive">{erreur}</p>}
      {carte && (
        <div className="flex items-center gap-3 rounded-md border p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={carte.qrCode}
            alt="QR de la carte"
            className="size-16 rounded"
          />
          <div className="text-sm">
            <p className="text-emerald-700 dark:text-emerald-400">
              Carte générée — PDF ouvert dans un nouvel onglet.
            </p>
            <a
              href={carte.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline"
            >
              Rouvrir le PDF
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
