'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { accepterInvitation } from '@/app/accepter-invitation/[token]/actions';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { annoncerOuvertureLente } from '@/components/effet-defilement';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * L'invité choisit son mot de passe. À la validation : appel serveur pour
 * l'activation (mot de passe → API Admin Supabase, jamais stocké), puis
 * connexion immédiate côté navigateur et redirection vers le dashboard.
 */
export function AccepterInvitationForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErreur(null);
        const f = new FormData(e.currentTarget);
        const mdp = String(f.get('motDePasse') ?? '');
        const confirmation = String(f.get('confirmation') ?? '');
        if (mdp !== confirmation) {
          setErreur('Les deux mots de passe ne correspondent pas.');
          return;
        }

        start(async () => {
          const res = await accepterInvitation({ token, motDePasse: mdp });
          if (!res.ok) {
            setErreur(res.error);
            return;
          }
          const supabase = createClient();
          const { error } = await supabase.auth.signInWithPassword({
            email: res.email,
            password: mdp,
          });
          if (error) {
            // compte activé mais connexion auto impossible : bascule sur /login
            router.push('/login');
            return;
          }
          annoncerOuvertureLente();
          router.push(res.dashboardRoute);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" value={email} disabled readOnly />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="motDePasse">Mot de passe</Label>
        <Input
          id="motDePasse"
          name="motDePasse"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="8 caractères minimum, lettres et chiffres"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmation">Confirmer le mot de passe</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      {erreur && <p className="text-sm text-destructive">{erreur}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Activation…' : 'Activer mon compte'}
      </Button>
    </form>
  );
}
