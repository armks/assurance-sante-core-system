'use client';

import { User } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { cn } from '@/lib/utils';

export type ResultatPhoto =
  | { ok: true; url: string; expiresIn: number }
  | { ok: false; error: string };

/**
 * Avatar cliquable + lien pour ajouter/changer une photo de profil (adhérent
 * ou bénéficiaire). Partagé par le self-service adhérent et l'écran de gestion
 * du personnel : le nommage et le dossier famille sont décidés côté API,
 * jamais ici.
 */
export function PhotoUploader({
  url,
  onUpload,
  libelle = 'Changer la photo',
  nomPersonne,
  compact = false,
}: {
  /** URL signée courte durée (jamais le chemin de stockage brut). */
  url: string | null;
  onUpload: (fd: FormData) => Promise<ResultatPhoto>;
  libelle?: string;
  /** Pour le nom accessible du bouton (« Photo de Konan Yao »). */
  nomPersonne?: string;
  /** Avatar plus petit, pour une ligne de tableau. */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [urlLocale, setUrlLocale] = useState(url);
  const nomAccessible = nomPersonne ? `${libelle} — ${nomPersonne}` : libelle;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className={cn(
          'relative shrink-0 overflow-hidden rounded-full border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
          compact ? 'size-9' : 'size-14',
        )}
        aria-label={nomAccessible}
        title={libelle}
      >
        {urlLocale ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL signée Storage, pas d'optimisation Next.js utile
          <img src={urlLocale} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-muted-foreground">
            <User aria-hidden="true" className={compact ? 'size-4' : 'size-5'} />
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          e.target.value = '';
          if (!fichier) return;
          const fd = new FormData();
          fd.set('photo', fichier);
          start(async () => {
            setErreur(null);
            const r = await onUpload(fd);
            if (r.ok) setUrlLocale(r.url);
            else setErreur(r.error);
          });
        }}
      />
      <div className="text-xs">
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {pending ? 'Envoi…' : libelle}
        </button>
        {erreur && (
          <p role="alert" className="text-destructive">
            {erreur}
          </p>
        )}
      </div>
    </div>
  );
}
