import type { Metadata } from 'next';
import Link from 'next/link';

import { Brand } from '@/components/brand';
import { AvatarUtilisateur, nomAffiche, resumeUtilisateur } from '@/components/dashboard/utilisateur-resume';
import { ProfilEcran } from '@/components/profil-ecran';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { exigerIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Mon profil' };

function Info({ libelle, valeur }: { libelle: string; valeur: string | null | undefined }) {
  if (!valeur) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{libelle}</dt>
      <dd className="font-medium">{valeur}</dd>
    </div>
  );
}

export default async function MonProfil() {
  const etat = await exigerIdentite('/profil');
  const identite = etat.kind === 'ok' ? etat.identity : null;
  const utilisateur = identite ? resumeUtilisateur(identite.profil, etat.email) : null;
  const retour = identite?.permissions.dashboardRoute ?? '/dashboard';

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <Brand />
        <Button asChild variant="ghost" size="sm">
          <Link href={retour}>← Retour à mon espace</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mon profil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {!utilisateur || !identite ? (
            <p className="text-sm text-muted-foreground">Votre compte n’a pas encore de rôle assigné.</p>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <AvatarUtilisateur utilisateur={utilisateur} taille="lg" />
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{nomAffiche(utilisateur)}</p>
                  <p className="truncate text-sm text-muted-foreground">{utilisateur.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {utilisateur.libelleRole && <Badge variant="secondary">{utilisateur.libelleRole}</Badge>}
                    {identite.profil.entite && <Badge variant="outline">{identite.profil.entite}</Badge>}
                  </div>
                </div>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Info libelle="Société d’assurance" valeur={identite.profil.organisationNom} />
                <Info libelle="Établissement de santé" valeur={identite.profil.etablissementNom} />
                <Info libelle="Pharmacie" valeur={identite.profil.pharmacieNom} />
                <Info libelle="Société souscriptrice" valeur={identite.profil.societeNom} />
                <Info libelle="Rôle" valeur={utilisateur.libelleRole ?? '—'} />
              </dl>
              <ProfilEcran utilisateur={utilisateur} />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
