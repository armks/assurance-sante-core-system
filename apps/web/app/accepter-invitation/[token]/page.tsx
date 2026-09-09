import type { Metadata } from 'next';
import Link from 'next/link';

import { AccepterInvitationForm } from '@/components/accepter-invitation-form';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetchPublic } from '@/lib/api';

export const metadata: Metadata = { title: 'Activer mon compte' };

interface ContexteInvitation {
  email: string;
  rolePropose: string;
  libelleRole: string;
  statut: string;
  expiree: boolean;
  acceptable: boolean;
}

export default async function AccepterInvitation({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await apiFetchPublic(
    `/api/v1/invitations/token/${encodeURIComponent(token)}`,
  );
  const ctx: ContexteInvitation | null = res.ok ? await res.json() : null;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/20 px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand size="lg" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {ctx?.acceptable
                ? 'Activez votre compte'
                : 'Invitation indisponible'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!ctx && (
              <>
                <p className="text-sm text-muted-foreground">
                  Ce lien d’invitation est invalide ou a été supprimé.
                </p>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/">Retour à l’accueil</Link>
                </Button>
              </>
            )}

            {ctx && !ctx.acceptable && (
              <>
                <p className="text-sm text-muted-foreground">
                  {ctx.expiree
                    ? 'Cette invitation a expiré. Demandez à votre administrateur de la renvoyer.'
                    : ctx.statut === 'ACCEPTEE'
                      ? 'Cette invitation a déjà été utilisée. Vous pouvez vous connecter.'
                      : ctx.statut === 'EN_ATTENTE_VALIDATION_INFORMATIQUE'
                        ? 'Cette invitation attend encore la validation d’un administrateur.'
                        : 'Cette invitation n’est plus active.'}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/login">Aller à la connexion</Link>
                </Button>
              </>
            )}

            {ctx && ctx.acceptable && (
              <>
                <p className="text-sm text-muted-foreground">
                  Rôle attribué :{' '}
                  <span className="font-medium text-foreground">
                    {ctx.libelleRole}
                  </span>
                  . Choisissez un mot de passe — votre administrateur ne le verra
                  jamais.
                </p>
                <AccepterInvitationForm token={token} email={ctx.email} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
