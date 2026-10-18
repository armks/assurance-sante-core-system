import { Receipt } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Bouton « Reçu de caisse » : ouvre le reçu (PDF à la mise en page de l'imprimante paramétrée : ticket thermique ou A4) dans un
 * nouvel onglet, prêt à imprimer. Réservé aux factures dont la part du patient est réglée.
 */
export function BoutonRecu({
  type,
  id,
  taille = 'sm',
  libelle = 'Reçu de caisse',
}: {
  type: 'facture-soins' | 'dispensation';
  id: string;
  taille?: 'xs' | 'sm';
  libelle?: string;
}) {
  return (
    <Button asChild size={taille} variant="default">
      <a href={`/api/recus/${type}/${id}`} target="_blank" rel="noopener noreferrer">
        <Receipt className="size-4" aria-hidden="true" /> {libelle}
      </a>
    </Button>
  );
}
