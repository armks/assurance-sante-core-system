package ci.assurance.adjudication.domain;

/** Résultat d'adjudication d'une réclamation (v12 §3, contrat d'API). */
public enum Decision {
  AUTO_ADJUDIQUE,
  REVUE_MANUELLE,
  REJETE
}
