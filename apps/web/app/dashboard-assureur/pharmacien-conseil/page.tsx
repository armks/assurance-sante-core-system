import { GraphiquesSoinsServeur } from '@/components/dashboard/exploitation/graphiques-soins-serveur';
import Link from 'next/link';
import { CreditCard, FileText, Pill } from 'lucide-react';

import { PageTitre } from '@/components/page-titre';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function PharmacienConseilAccueil() {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Pharmacien Conseil — gouvernance du référentiel des médicaments et revue des prescriptions."
      />
      <GraphiquesSoinsServeur />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/dashboard-assureur/pharmacien-conseil/medicaments-a-homologuer" className="group block">
          <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <Pill className="size-4" />
                </span>
                <CardTitle className="text-base">Médicaments à homologuer</CardTitle>
              </div>
              <CardDescription className="pt-1">
                Valider ou suspendre les médicaments du référentiel. L’homologation
                d’un médicament est réservée au pharmacien conseil.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/dashboard-assureur/pharmacien-conseil/prescriptions" className="group block">
          <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <FileText className="size-4" />
                </span>
                <CardTitle className="text-base">Prescriptions à examiner</CardTitle>
              </div>
              <CardDescription className="pt-1">
                Revue des ordonnances délivrées, accès au dossier complet du patient et
                contestation d’une ligne auprès de la pharmacie concernée.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/dashboard-assureur/pharmacien-conseil/factures-mensuelles" className="group block">
          <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <CreditCard className="size-4" />
                </span>
                <CardTitle className="text-base">Factures mensuelles</CardTitle>
              </div>
              <CardDescription className="pt-1">
                Valide la consolidation mensuelle de chaque pharmacie avant qu’elle ne soit
                débloquée pour le comptable.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
