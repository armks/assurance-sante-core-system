'use client';

import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

import { Brand } from '@/components/brand';
import { LoginForm } from '@/components/login-form';

/**
 * Connexion en superposition par-dessus la page d'accueil (route interceptée).
 * Échap, clic hors de la carte ou bouton × : `router.back()` ramène à l'accueil
 * déjà affiché en arrière-plan, sans le recharger. Le formulaire est le même
 * que celui de la page `/login`.
 */
export function ConnexionModale() {
  const router = useRouter();

  return (
    <DialogPrimitive.Root open onOpenChange={(ouvert) => !ouvert && router.back()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="accueil-fondu fixed inset-0 z-50 bg-foreground/30 backdrop-blur-md" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="accueil-fondu fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Connexion</DialogPrimitive.Title>
          <div className="relative">
            {/* Même effet d'ouverture que le méga menu : le logo descend en fondu, puis la carte de connexion se déroule du haut. */}
            <div className="megamenu-colonne mb-4 flex justify-center rounded-xl border bg-card px-4 py-3 shadow-2xl" style={{ animationDelay: '250ms' }}>
              <Brand />
            </div>
            <div className="megamenu-panneau" style={{ animationDelay: '500ms' }}>
              <LoginForm className="[&>div]:shadow-2xl" />
            </div>
            <DialogPrimitive.Close className="absolute right-3 top-[4.75rem] rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Fermer</span>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
