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
      {/* Titre en parallaxe très douce : il traîne de quelques pixels derrière la page au défilement (les boutons d'action restent fixes). */}
      <div data-parallaxe="0.08" data-parallaxe-origine="haut" data-parallaxe-max="14">
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
