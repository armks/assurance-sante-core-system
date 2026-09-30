'use client';

import { ExternalLink } from 'lucide-react';
import { useId, useState, useTransition } from 'react';

import { modifierSlugOrganisation } from '@/app/superadmin/societes/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Section « Page d'accueil » d'une organisation : URL publique complète
 * (`{origine}/{slug}`) et lien de prévisualisation. Chemin modifiable par
 * SUPERADMIN_PRINCIPAL uniquement (`peutModifier`, revérifié par l'API : format,
 * segments réservés, unicité).
 */
export function PagePubliqueOrganisation({
  organisationId,
  slug: slugInitial,
  origine,
  peutModifier,
}: {
  organisationId: string;
  slug: string;
  origine: string;
  peutModifier: boolean;
}) {
  const id = useId();
  const [slug, setSlug] = useState(slugInitial);
  const [saisie, setSaisie] = useState(slugInitial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const url = `${origine}/${slug}`;

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-medium text-primary underline-offset-4 hover:underline"
        >
          {url}
        </a>
        <Button asChild size="xs" variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            Prévisualiser
          </a>
        </Button>
      </p>

      {peutModifier && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setMessage(null);
              const r = await modifierSlugOrganisation(organisationId, saisie.trim().toLowerCase());
              if (r.ok) {
                setSlug(r.slug);
                setSaisie(r.slug);
                setMessage({ ok: true, texte: 'Chemin enregistré.' });
              } else {
                setMessage({ ok: false, texte: r.error });
              }
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-slug`}>Chemin</Label>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span aria-hidden="true">/</span>
              <Input
                id={`${id}-slug`}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                required
                minLength={2}
                maxLength={60}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Minuscules sans accent, chiffres et tirets simples."
                className="h-8 w-64 font-mono text-sm"
                aria-describedby={`${id}-aide`}
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={pending || saisie.trim() === slug}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <p id={`${id}-aide`} className="w-full text-xs text-muted-foreground">
            Minuscules sans accent, chiffres et tirets. L’ancienne adresse cessera de fonctionner.
          </p>
        </form>
      )}
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-xs text-emerald-700 dark:text-emerald-400' : 'text-xs text-destructive'}>
          {message.texte}
        </p>
      )}
    </div>
  );
}
