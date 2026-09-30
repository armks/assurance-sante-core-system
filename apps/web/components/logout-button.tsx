'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { destinationApresDeconnexion } from '@/app/deconnexion-actions';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/**
 * Unique bouton de déconnexion (shells dashboard et superadmin, écrans de
 * message). Avant le `signOut`, la destination est demandée au serveur
 * (`destinationApresDeconnexion`) : page d'accueil de l'organisation de
 * l'utilisateur (`/{slug}`, établissement et pharmacie compris via leur
 * assureur) si elle est active, sinon `/` (superadmin, organisation
 * suspendue…). Après un `signOut` réussi : navigation client vers cette page,
 * sans rechargement ; `replace` : la page protégée quittée ne reste pas dans
 * l'historique.
 *
 * Pas de `router.refresh()` ici : il re-rendrait la page protégée courante,
 * désormais sans session, et le proxy la redirigerait vers `/login?next=…`
 * en concurrence avec la navigation. `/` et `/{slug}` lisent la session côté
 * serveur à chaque navigation (rendu dynamique) : elles arrivent déjà à jour.
 */
export function LogoutButton() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState(false);

  const logout = async () => {
    setEnCours(true);
    setEchec(false);
    const destination = await destinationApresDeconnexion();
    const { error } = await createClient().auth.signOut();
    if (error) {
      setEnCours(false);
      setEchec(true);
      return;
    }
    router.replace(destination);
  };

  return (
    <Button onClick={logout} variant="outline" size="sm" disabled={enCours}>
      {echec ? 'Échec, réessayer' : enCours ? 'Déconnexion…' : 'Se déconnecter'}
    </Button>
  );
}
