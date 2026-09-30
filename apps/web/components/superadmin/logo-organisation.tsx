'use client';

import { ImageIcon, Upload } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { modifierLogoOrganisation } from '@/app/superadmin/societes/actions';
import { Button } from '@/components/ui/button';

/**
 * Section « Logo » d'une organisation : aperçu + remplacement. Le logo est
 * imprimé dans l'en-tête de la carte de membre PDF (PNG/JPEG, 2 Mo max —
 * contrôlé par l'API). Bouton réservé à SUPERADMIN_PRINCIPAL (`peutModifier`) ;
 * l'aperçu reste visible pour les autres rôles superadmin.
 */
export function LogoOrganisation({
  organisationId,
  organisationNom,
  logoUrl,
  peutModifier,
}: {
  organisationId: string;
  organisationNom: string;
  logoUrl: string | null;
  peutModifier: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [url, setUrl] = useState(logoUrl);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid h-16 w-40 shrink-0 place-items-center overflow-hidden rounded-md border bg-white p-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL publique Storage, pas d'optimisation Next.js utile
          <img src={url} alt={`Logo de ${organisationNom}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ImageIcon aria-hidden="true" className="size-4" />
            Aucun logo
          </span>
        )}
      </div>
      <div className="space-y-1 text-sm">
        <p className="text-muted-foreground">
          Imprimé dans l’en-tête des cartes de membre. PNG ou JPEG, 2 Mo maximum.
        </p>
        {peutModifier && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const fichier = e.target.files?.[0];
                e.target.value = '';
                if (!fichier) return;
                const fd = new FormData();
                fd.set('logo', fichier);
                start(async () => {
                  setMessage(null);
                  const r = await modifierLogoOrganisation(organisationId, fd);
                  if (r.ok) {
                    setUrl(r.logoUrl);
                    setMessage({ ok: true, texte: 'Logo enregistré.' });
                  } else {
                    setMessage({ ok: false, texte: r.error });
                  }
                });
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              <Upload aria-hidden="true" className="size-4" />
              {pending ? 'Envoi…' : url ? 'Remplacer le logo' : 'Ajouter un logo'}
            </Button>
          </>
        )}
        {message && (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={message.ok ? 'text-xs text-emerald-700 dark:text-emerald-400' : 'text-xs text-destructive'}
          >
            {message.texte}
          </p>
        )}
      </div>
    </div>
  );
}
