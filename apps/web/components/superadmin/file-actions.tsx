'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  annulerActionSuperadmin,
  type ActionEnAttente,
} from '@/app/superadmin/societes/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const LIBELLE_ACTION: Record<string, string> = {
  CREATION_ORGANISATION: 'Création d’organisation',
  SUSPENSION_ORGANISATION: 'Suspension d’organisation',
  PROLONGATION_ORGANISATION: 'Prolongation de licence',
};

const dateHeure = (d: string) =>
  new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * File des actions sensibles initiées et pas encore confirmées par code
 * (statut EMIS). Chaque ligne peut être annulée avant sa confirmation : elle
 * disparaît alors de la file après rafraîchissement.
 */
export function FileActionsEnAttente({
  actions,
}: {
  actions: ActionEnAttente[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  if (actions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Actions en attente de confirmation ({actions.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ces actions ont été initiées mais pas encore validées par le code reçu
          par e-mail. Vous pouvez en annuler une tant qu’elle n’est pas confirmée.
        </p>
        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        <ul className="divide-y rounded-lg border">
          {actions.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {LIBELLE_ACTION[a.action] ?? a.action}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    initiée le {dateHeure(a.dateEmission)} · expire le{' '}
                    {dateHeure(a.dateExpiration)}
                  </span>
                </div>
                <p className="mt-1 text-sm">{a.resume}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending && enCours === a.id}
                onClick={() => {
                  setErreur(null);
                  setEnCours(a.id);
                  start(async () => {
                    const r = await annulerActionSuperadmin(a.id);
                    if (r.ok) {
                      router.refresh();
                    } else {
                      setErreur(r.error);
                    }
                    setEnCours(null);
                  });
                }}
              >
                {pending && enCours === a.id ? 'Annulation…' : 'Annuler'}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
