import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { EcranMessage } from '@/components/ecran-message';
import { etatIdentite } from '@/lib/identity';

export const metadata: Metadata = { title: 'Accès suspendu' };

/**
 * Écran unique d'un compte dont la société est SUSPENDUE / inactive : toutes
 * les pages protégées y redirigent (`exigerIdentite`). L'API refuse déjà
 * chaque requête de ce compte (403 ORGANISATION_SUSPENDUE) ; ici on l'explique
 * et on propose de se déconnecter, au lieu d'une page cassée.
 */
export default async function AccesSuspenduPage() {
  const etat = await etatIdentite();
  if (etat.kind === 'anonyme') redirect('/login');
  // Société réactivée entre-temps : retour à l'espace normal.
  if (etat.kind !== 'organisation-suspendue') redirect('/dashboard');

  const suspendue = etat.code === 'ORGANISATION_SUSPENDUE';
  const archive = etat.code === 'PERIMETRE_ARCHIVE' || etat.code === 'COMPTE_DESACTIVE';
  return (
    <EcranMessage
      tonalite="erreur"
      titre={etat.code === 'COMPTE_DESACTIVE' ? 'Compte désactivé' : archive ? 'Accès coupé' : suspendue ? 'Accès suspendu' : 'Société inactive'}
      description={etat.message}
    >
      <p className="text-muted-foreground">
        Connecté en tant que <span className="font-medium text-foreground">{etat.email}</span>.
        {suspendue &&
          ' Votre compte n’est pas supprimé : l’accès sera rétabli si la société est réactivée.'}
      </p>
    </EcranMessage>
  );
}
