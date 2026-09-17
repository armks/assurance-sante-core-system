import Link from 'next/link';
import { ClipboardList, Stethoscope } from 'lucide-react';

import { PageTitre } from '@/components/page-titre';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function MedecinConseilAccueil() {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Médecin Conseil — gouvernance du référentiel des actes."
      />
      <div className="grid gap-4 sm:grid-cols-2">
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
