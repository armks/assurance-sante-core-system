import { FileText, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Boutons d'impression d'une facture (PDF ou Word). Le téléchargement passe par `/api/documents/{type}/{id}` : la session de
 * l'utilisateur est relayée à l'API, qui contrôle le périmètre (établissement ou pharmacie du demandeur) et le règlement.
 */
export function BoutonsImpression({
  type,
  id,
  libelle = 'Imprimer la facture',
  taille = 'sm',
}: {
  type: 'facture-soins' | 'facture-pharmacie';
  id: string;
  libelle?: string;
  taille?: 'xs' | 'sm';
}) {
  const lien = (format: 'pdf' | 'docx') => `/api/documents/${type}/${id}?format=${format}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Button asChild size={taille} variant="outline">
        <a href={lien('pdf')}>
          <Printer className="size-4" aria-hidden="true" /> {libelle} (PDF)
        </a>
      </Button>
      <Button asChild size={taille} variant="ghost">
        <a href={lien('docx')} aria-label={`${libelle} au format Word`}>
          <FileText className="size-4" aria-hidden="true" /> Word
        </a>
      </Button>
    </span>
  );
}
