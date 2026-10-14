/** En-tête de page cohérent pour toutes les sections du dashboard. */
export function PageTitre({
  titre,
  description,
  action,
  uneLigne,
}: {
  titre: string;
  description?: string;
  action?: React.ReactNode;
  /** Affiche la description sur une seule ligne (sans retour à la ligne). */
  uneLigne?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      {/* Titre en parallaxe très douce : il traîne de quelques pixels derrière la page au défilement (les boutons d'action restent fixes). */}
      <div data-parallaxe="0.08" data-parallaxe-origine="haut" data-parallaxe-max="14">
        <h1 className="text-xl font-semibold tracking-tight">{titre}</h1>
        {description && (
          <p className={`mt-1 text-sm text-muted-foreground ${uneLigne ? 'whitespace-nowrap' : 'max-w-2xl'}`}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
