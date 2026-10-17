import { GraphiquesSoinsServeur } from '@/components/dashboard/exploitation/graphiques-soins-serveur';
import Link from 'next/link';
import { ClipboardList, FileSignature, Stethoscope } from 'lucide-react';

import { PageTitre } from '@/components/page-titre';
import { apiFetch } from '@/lib/api';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function MedecinConseilAccueil() {
  // compteur de la file « Tarifs proposés à examiner » (jamais bloquant pour la page)
  let compteur: { aExaminer: number; alertesRenforcees: number; enRetard: number } | null = null;
  try {
    const res = await apiFetch('/api/v1/tarifs-proposes/compteur');
    if (res.ok) compteur = await res.json();
  } catch {
    compteur = null;
  }
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Médecin Conseil — gouvernance du référentiel des actes."
      />
      <GraphiquesSoinsServeur />
      <div className="grid gap-4 sm:grid-cols-2">
        {compteur && (
          <Link href="/dashboard-assureur/medecin-conseil/tarifs-proposes" className="group block sm:col-span-2" data-testid="compteur-tarifs-proposes">
            <Card className={`h-full transition-colors group-hover:bg-accent/40 ${compteur.alertesRenforcees > 0 ? 'border-amber-400' : ''}`}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                    <FileSignature className="size-4" />
                  </span>
                  <CardTitle className="text-base">
                    {compteur.aExaminer} tarif{compteur.aExaminer > 1 ? 's' : ''} proposé{compteur.aExaminer > 1 ? 's' : ''} à examiner
                  </CardTitle>
                </div>
                <CardDescription className="pt-1">
                  {compteur.alertesRenforcees} alerte{compteur.alertesRenforcees > 1 ? 's' : ''} renforcée{compteur.alertesRenforcees > 1 ? 's' : ''} ·{' '}
                  {compteur.enRetard} en retard de décision.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
        <Link
          href="/dashboard-assureur/medecin-conseil/actes-a-homologuer"
          className="group block"
        >
          <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <Stethoscope className="size-4" />
                </span>
                <CardTitle className="text-base">Actes à homologuer</CardTitle>
              </div>
              <CardDescription className="pt-1">
                Valider ou suspendre les actes du référentiel. L’homologation d’un
                acte est réservée au médecin conseil.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link
          href="/dashboard-assureur/medecin-conseil/preautorisations"
          className="group block"
        >
          <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <ClipboardList className="size-4" />
                </span>
                <CardTitle className="text-base">Pré-autorisations</CardTitle>
              </div>
              <CardDescription className="pt-1">
                Analyses / examens médicaux en attente de validation — aucun
                paiement patient n’est possible avant votre décision.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
