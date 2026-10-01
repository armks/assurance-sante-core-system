/**
 * Recherche plein texte des tableaux (DataTable) — insensible à la casse ET aux
 * accents, comme on l'attend en français : « Societe » trouve « Société »,
 * « fievre » trouve « Fièvre ». Apostrophes typographiques (’) et espaces
 * (insécables, multiples) sont aussi normalisés.
 */
export function normaliserRecherche(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Vrai si CHAQUE mot de la requête figure dans au moins un des champs : « Kouassi
 * Yao » trouve la personne même si prénom et nom sont deux champs distincts, et
 * dans n'importe quel ordre. Requête vide → tout correspond.
 */
export function correspondRecherche(valeurs: unknown[], requete: string): boolean {
  const mots = normaliserRecherche(requete).split(' ').filter(Boolean);
  if (mots.length === 0) return true;
  const textes = valeurs.map((v) => normaliserRecherche(String(v ?? '')));
  return mots.every((mot) => textes.some((t) => t.includes(mot)));
}
