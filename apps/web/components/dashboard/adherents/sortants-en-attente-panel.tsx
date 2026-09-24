'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { validerSortants } from '@/app/dashboard-assureur/adherents-actions';
import { StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIBELLE_STATUT_MEMBRE, TON_STATUT_MEMBRE } from '@/lib/member';
import type { AdherentListe } from './types';

const LIBELLE_CIBLE: Record<string, string> = { SUSPENDU: 'Suspendre', RADIE: 'Radier' };

/**
 * Mouvements de personnel — sortants en attente de validation (statut
 * PROPOSE_SORTANT), réservé ASSUREUR_INFORMATIQUE/EXPLOITATION. Effectif
 * (SUSPENDU/RADIE, `statutSortantCible`) IMMÉDIATEMENT une fois validé.
 */
export function SortantsEnAttentePanel({ sortants }: { sortants: AdherentListe[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function valider(adherentId: string) {
    start(async () => {
      setErreur(null);
      const r = await validerSortants([adherentId]);
      if (r.ok) router.refresh();
      else setErreur(r.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sortants en attente de validation ({sortants.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        {sortants.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun mouvement de sortie en attente.</p>
        )}
        {sortants.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
            <div className="text-sm">
              <span className="font-medium">{a.nom} {a.prenom}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {a.souscripteur?.nom} → {LIBELLE_CIBLE[a.statutSortantCible ?? ''] ?? a.statutSortantCible} · {a.motifSortie}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <StatutBadge statut={a.statut} map={TON_STATUT_MEMBRE} libelles={LIBELLE_STATUT_MEMBRE} />
              <Button size="xs" disabled={pending} onClick={() => valider(a.id)}>
                Valider
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
