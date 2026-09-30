'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/**
 * Unique bouton de déconnexion (shells dashboard et superadmin, écrans de
 * message). Après un `signOut` réussi : navigation client vers la page
 * d'accueil publique `/`, sans rechargement. `replace` : la page protégée
 * quittée ne reste pas dans l'historique.
 *
 * Pas de `router.refresh()` ici : il re-rendrait la page protégée courante,
 * désormais sans session, et le proxy la redirigerait vers `/login?next=…`
 * en concurrence avec la navigation vers `/`. La page `/` lit la session côté
 * serveur à chaque navigation (rendu dynamique) : elle arrive déjà à jour.
 */
export function LogoutButton() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState(false);

  const logout = async () => {
    setEnCours(true);
    setEchec(false);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setEnCours(false);
      setEchec(true);
      return;
    }
    router.replace('/');
  };

  return (
    <Button onClick={logout} variant="outline" size="sm" disabled={enCours}>
      {echec ? 'Échec, réessayer' : enCours ? 'Déconnexion…' : 'Se déconnecter'}
    </Button>
  );
}
