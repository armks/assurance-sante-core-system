/**
 * Limiteur de débit en mémoire, fenêtre glissante — pour les formulaires
 * publics de la page d'accueil (aucune authentification, donc exposés au spam).
 *
 * Deux niveaux, vérifiés ensemble :
 *   - par clé (adresse IP du visiteur) : freine un envoi répété depuis un poste ;
 *   - global (toutes clés confondues) : plafond absolu, qui borne le volume
 *     d'e-mails même si l'IP est falsifiée ou tourne (en-tête X-Forwarded-For).
 *
 * En mémoire du processus : suffisant pour une instance unique. Avec plusieurs
 * instances derrière un répartiteur, chaque instance a ses propres compteurs
 * (le plafond réel est alors multiplié par le nombre d'instances) — passer à
 * un stockage partagé (Redis, table Postgres) à ce moment-là.
 */
export interface ReglesLimite {
  /** Requêtes autorisées par clé dans la fenêtre. */
  parCle: number;
  /** Requêtes autorisées toutes clés confondues dans la fenêtre. */
  global: number;
  /** Durée de la fenêtre glissante, en millisecondes. */
  fenetreMs: number;
}

export type ResultatLimite = { autorise: true } | { autorise: false; reessayerDansS: number };

export class LimiteurRequetes {
  private readonly parCle = new Map<string, number[]>();
  private globalHorodatages: number[] = [];

  constructor(
    private readonly regles: ReglesLimite,
    private readonly maintenant: () => number = Date.now,
  ) {}

  /** Enregistre la tentative si elle est autorisée ; sinon ne compte rien. */
  consommer(cle: string): ResultatLimite {
    const t = this.maintenant();
    const debut = t - this.regles.fenetreMs;
    this.globalHorodatages = this.globalHorodatages.filter((h) => h > debut);
    const historique = (this.parCle.get(cle) ?? []).filter((h) => h > debut);

    const pleinCle = historique.length >= this.regles.parCle;
    const pleinGlobal = this.globalHorodatages.length >= this.regles.global;
    if (pleinCle || pleinGlobal) {
      const plusAncien = pleinCle ? historique[0] : this.globalHorodatages[0];
      this.parCle.set(cle, historique);
      return {
        autorise: false,
        reessayerDansS: Math.max(1, Math.ceil((plusAncien + this.regles.fenetreMs - t) / 1000)),
      };
    }

    historique.push(t);
    this.parCle.set(cle, historique);
    this.globalHorodatages.push(t);
    this.nettoyer(debut);
    return { autorise: true };
  }

  /** Évite une croissance sans fin de la table quand beaucoup d'IP passent. */
  private nettoyer(debut: number): void {
    if (this.parCle.size < 5000) return;
    for (const [cle, hs] of this.parCle) {
      if (!hs.some((h) => h > debut)) this.parCle.delete(cle);
    }
  }
}
