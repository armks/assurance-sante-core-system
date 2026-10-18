import { BookOpenText } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** Texte officiel de la nomenclature des actes (NGAMBCI, décembre 2019) : ouvre le PDF dans un nouvel onglet. */
export function BoutonNomenclature() {
  return (
    <Button asChild variant="outline" size="sm">
      <a href="/api/nomenclature" target="_blank" rel="noopener noreferrer">
        <BookOpenText className="size-4" aria-hidden="true" /> Nomenclature officielle (PDF)
      </a>
    </Button>
  );
}
