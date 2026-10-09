package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

/**
 * Frontière d'accès aux données de l'adjudication. Une implémentation JDBC unique
 * (rôle Postgres {@code svc_adjudication}) ; l'interface permet un test unitaire
 * du pipeline sans base de données.
 *
 * Toutes les méthodes sont appelées à l'intérieur de la MÊME transaction
 * (ouverte par {@code @Transactional} sur AdjudicationService).
 */
public interface AdjudicationRepository {

  /** Réclamation + garantie applicable + police, en une requête. */
  Optional<ContexteAdjudication> chargerContexte(UUID reclamationId);

  /** Un remboursement existe-t-il déjà pour cette réclamation ? (doublon) */
  boolean remboursementExiste(UUID reclamationId);

  /**
   * Verrou pessimiste transactionnel keyé sur la personne (adhérent, bénéficiaire, ou
   * la police à défaut) — ou sur la FAMILLE (titulaire) quand le produit a un plafond
   * famille ({@link #produitAPlafondFamille}) :
   * {@code SELECT pg_advisory_xact_lock(hashtextextended(?, 0))}. Deux adjudications
   * concurrentes pour le même adhérent ne peuvent PAS calculer le plafond en même
   * temps ; le verrou est relâché automatiquement au commit / rollback.
   *
   * <p>On n'utilise pas {@code SELECT ... FOR UPDATE} sur {@code polices} : cela
   * exigerait le privilège {@code UPDATE} sur la table, ce qui sur-privilégierait
   * le rôle {@code svc_adjudication} (il ne modifie jamais de police).
   */
  void verrouillerPourPlafond(UUID cle);

  /**
   * Montant déjà pris en charge par l'assureur sur la {@code periode}, pour la
   * PERSONNE assurée ET la GARANTIE — c'est ce qui consomme le plafond annuel par
   * personne : les remboursements adjugés PLUS la part assurance des lignes de
   * facturation tiers payant (actes facturés par l'établissement ; la garantie d'une
   * ligne est celle du produit de la police pour la catégorie de l'acte). Personne :
   * l'adhérent titulaire si {@code adherentId} est renseigné, sinon le
   * bénéficiaire. Les deux nuls : zéro. Seule définition du cumul, utilisée par
   * l'adjudication, la simulation et l'état des plafonds. {@code actesExclus} : actes
   * dont les lignes de facturation ne comptent pas (actes en cours de (re)facturation,
   * simulés dans la même demande — une ligne orpheline réattachée ne doit pas compter
   * deux fois) ; vide pour une adjudication.
   */
  BigDecimal sommeConsommeePersonne(
      UUID adherentId,
      UUID beneficiaireId,
      UUID garantieId,
      java.util.Collection<UUID> actesExclus,
      PeriodeCumul periode);

  /**
   * Même cumul que {@link #sommeConsommeePersonne}, pour la FAMILLE : le titulaire
   * {@code titulaireId} ET tous ses bénéficiaires (y compris supprimés depuis : leur
   * consommation passée reste due), quelle que soit la colonne renseignée sur la
   * réclamation ou le dossier (un bénéficiaire a {@code adherent_id} NULL).
   */
  BigDecimal sommeConsommeeFamille(
      UUID titulaireId,
      UUID garantieId,
      java.util.Collection<UUID> actesExclus,
      PeriodeCumul periode);

  /** Titulaire de la famille : {@code adherentId} s'il est renseigné, sinon celui du bénéficiaire. */
  UUID titulaireDe(UUID adherentId, UUID beneficiaireId);

  /**
   * Le produit a-t-il au moins une garantie avec un plafond annuel FAMILLE ? Si oui, le
   * verrou du plafond porte sur la famille (titulaire) pour TOUS ses membres et TOUTES
   * ses garanties — même règle que le core NestJS (`verrou-plafond.ts`) pour qu'une
   * facture et une adjudication se sérialisent toujours sur la même clé.
   */
  boolean produitAPlafondFamille(UUID produitId);

  /** Garanties du produit portant au moins un plafond annuel (personne ou famille). */
  java.util.List<GarantieApplicable> garantiesAvecPlafondAnnuel(UUID produitId);

  /** Bénéficiaires (non supprimés) d'un titulaire. */
  java.util.List<UUID> beneficiairesDe(UUID titulaireId);

  /** Garantie (simulation) — vide si absente ou supprimée. */
  Optional<GarantieApplicable> chargerGarantie(UUID garantieId);

  /** Police (simulation) — vide si absente ou supprimée. */
  Optional<PoliceApplicable> chargerPolice(UUID policeId);

  // --- Résolution du tarif (ADR-008, lot 3) : lectures FILTRÉES PAR ORGANISATION ------------

  /** Ligne d'exception d'une convention : forfait OU valeur de lettre-clé propre à l'acte. */
  record LigneConvention(UUID id, BigDecimal prixForfaitaire, BigDecimal valeurLettreCle) {}

  /** Cotation d'un acte du référentiel : lettre-clé et coefficient. */
  record CotationActe(String lettreCle, BigDecimal coefficient) {}

  /**
   * Convention de l'établissement EN VIGUEUR à {@code date} : VALIDEE, ou ARCHIVEE (fermée par une nouvelle
   * version) dont la période couvre encore la date. Vide = mode de transition. Les périodes d'un établissement
   * ne se chevauchent pas (contrainte d'exclusion) : au plus une convention, sans trou entre une version fermée
   * la veille et la suivante.
   */
  default Optional<ConventionApplicable> conventionEnVigueur(
      UUID organisationId, UUID etablissementId, java.time.LocalDate date) {
    return Optional.empty();
  }

  /** Ligne de la convention pour l'acte, valable à {@code date} (période propre de la ligne comprise). */
  default Optional<LigneConvention> ligneConvention(UUID conventionId, UUID referentielActeId, java.time.LocalDate date) {
    return Optional.empty();
  }

  /** Cotation de l'acte, dans l'organisation. */
  default Optional<CotationActe> cotationActe(UUID organisationId, UUID referentielActeId) {
    return Optional.empty();
  }

  /** Valeur négociée de la lettre-clé dans la convention pour le contexte, ou vide. */
  default Optional<BigDecimal> valeurLettreCle(UUID conventionId, String lettreCle, String contexte) {
    return Optional.empty();
  }

  /** Acte du référentiel de L'ORGANISATION portant ce code (le code est unique par organisation). */
  default Optional<UUID> referentielActeId(UUID organisationId, String codeActe) {
    return Optional.empty();
  }

  /** Tarif proposé par l'établissement pour un acte (ADR-008, lot 4). */
  record TarifProposeActe(UUID id, String statut, java.math.BigDecimal montantPropose, java.math.BigDecimal montantDecide) {}

  /** Dernier tarif proposé non supprimé de l'acte, dans l'organisation (REFUSE compris : il ne donne aucun tarif). */
  default Optional<TarifProposeActe> tarifProposePourActe(UUID organisationId, UUID acteDossierId) {
    return Optional.empty();
  }

  /** Données de tarification de la réclamation (acte, établissement, date des soins, type de visite). */
  default Optional<ContexteTarif> contexteTarifReclamation(UUID reclamationId) {
    return Optional.empty();
  }

  /** Type de visite du dossier de soins d'un acte (contexte ambulatoire / hospitalisation), ou {@code null}. */
  default String typeVisiteDeActe(UUID acteDossierId) {
    return null;
  }

  /**
   * Trace sur l'acte adjugé le tarif conventionné (ligne de forfait) appliqué — seule écriture autorisée sur
   * {@code actes_dossier} (prisma/sql/074).
   */
  default void tracerTarifActe(UUID acteDossierId, UUID tarifConventionneId) {}

  /** INSERT dans {@code remboursements} ... RETURNING id. */
  UUID insererRemboursement(
      UUID reclamationId,
      BigDecimal montantRembourse,
      BigDecimal plafondRestantApres,
      String decision,
      long dureeTraitementMs);

  /**
   * {@code UPDATE reclamations SET statut = ? WHERE id = ? AND statut = 'EN_ADJUDICATION'}.
   * @return nombre de lignes affectées (0 = la réclamation a changé de statut entre-temps).
   */
  int majStatut(UUID reclamationId, String statut);

  /** Trace la décision via {@code SELECT log_audit(...)}. */
  void journaliser(UUID reclamationId, UUID svcUserId, Adjudicateur.Resultat resultat);
}
