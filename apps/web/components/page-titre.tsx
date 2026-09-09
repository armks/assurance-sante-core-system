/** En-tête de page cohérent pour toutes les sections du dashboard. */
export function PageTitre({
  titre,
  description,
  action,
}: {
  titre: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{titre}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
