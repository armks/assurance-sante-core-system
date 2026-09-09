import { PageTitre } from '@/components/page-titre';

/** Page de section encore vide — juste le titre + un placeholder. */
export function SectionVide({
  titre,
  description,
  note = 'Cette section sera branchée sur l’API dans un prochain prompt.',
}: {
  titre: string;
  description?: string;
  note?: string;
}) {
  return (
    <div className="space-y-8">
      <PageTitre titre={titre} description={description} />
      <div className="grid place-items-center rounded-xl border border-dashed bg-background/50 px-6 py-16 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}
