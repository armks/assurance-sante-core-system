'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { modifierPseudo, supprimerPhoto, televerserPhoto } from '@/app/profil/actions';
import { AvatarUtilisateur, type UtilisateurResume } from '@/components/dashboard/utilisateur-resume';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Modification du pseudo et de la photo — chacun ne modifie que les siens. */
export function ProfilEcran({ utilisateur }: { utilisateur: UtilisateurResume }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [pseudo, setPseudo] = useState(utilisateur.pseudo ?? '');
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | null>(null);
  const [version, setVersion] = useState(0);

  const terminer = (r: { ok: true } | { ok: false; error: string }, texteOk: string) => {
    if (r.ok) {
      setMessage({ ton: 'ok', texte: texteOk });
      setVersion((v) => v + 1);
      router.refresh();
    } else {
      setMessage({ ton: 'erreur', texte: r.error });
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Photo</h2>
        <div className="flex flex-wrap items-center gap-4">
          <AvatarUtilisateur utilisateur={utilisateur} taille="lg" cle={version} />
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const formulaire = e.currentTarget;
              const donnees = new FormData(formulaire);
              demarrer(async () => {
                terminer(await televerserPhoto(donnees), 'Photo enregistrée.');
                formulaire.reset();
              });
            }}
          >
            <Input name="photo" type="file" required accept="image/jpeg,image/png,image/webp" className="max-w-xs" aria-label="Choisir une photo" />
            <Button type="submit" size="sm" disabled={enCours}>Enregistrer la photo</Button>
            {utilisateur.aPhoto && (
              <Button type="button" size="sm" variant="ghost" disabled={enCours} onClick={() => demarrer(async () => terminer(await supprimerPhoto(), 'Photo supprimée.'))}>
                Supprimer
              </Button>
            )}
          </form>
        </div>
        <p className="text-xs text-muted-foreground">JPEG, PNG ou WEBP, 5 Mo maximum.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Pseudo</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            demarrer(async () => terminer(await modifierPseudo(pseudo.trim()), pseudo.trim() ? 'Pseudo enregistré.' : 'Pseudo retiré.'));
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="pseudo">Pseudo d’affichage (facultatif)</Label>
            <Input id="pseudo" value={pseudo} maxLength={30} onChange={(e) => setPseudo(e.target.value)} placeholder="Ex. Dr Koné" className="w-64" />
          </div>
          <Button type="submit" size="sm" disabled={enCours}>Enregistrer</Button>
        </form>
        <p className="text-xs text-muted-foreground">Affiché à la place de votre e-mail. Unique dans votre organisation.</p>
      </section>

      {message && (
        <p role="status" className={message.ton === 'ok' ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
          {message.texte}
        </p>
      )}
    </div>
  );
}
