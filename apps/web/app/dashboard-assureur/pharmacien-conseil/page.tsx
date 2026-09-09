import Link from 'next/link';
import { Pill } from 'lucide-react';

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
        description="Espace Pharmacien Conseil — gouvernance du référentiel des médicaments."
      />
      <Link
        href="/dashboard-assureur/pharmacien-conseil/medicaments-a-homologuer"
        className="group block max-w-md"
      >
        <Card className="transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
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
    </div>
  );
}
