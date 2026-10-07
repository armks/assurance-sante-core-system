package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Vue en lecture, sur UNE seule réclamation, de tout ce qui est nécessaire au
 * calcul : la réclamation (colonnes autorisées au rôle svc_adjudication), la
 * garantie applicable et la police.
 *
 * Les montants sont des {@link BigDecimal} — jamais double/float dans ce service.
 */
public record ContexteAdjudication(
    // --- réclamation (SELECT autorisé : 12 colonnes) ---
    UUID id,
    UUID organisationId,
    UUID dossierSoinsId,
    UUID acteDossierId,
    UUID adherentId,
    UUID beneficiaireId,
    UUID policeId,
    UUID garantieId,
    BigDecimal montant,
    String typeReclamation,
    String statut,
    Instant createdAt,
    // --- garantie applicable ---
    BigDecimal tauxCouverturePct,
    BigDecimal plafondParActe,
    // plafonds annuels (prisma/sql/069), chacun nullable = absent : le plus
    // restrictif des deux s'applique
    BigDecimal plafondAnnuelPersonne,
    BigDecimal plafondAnnuelFamille,
    BigDecimal franchise,
    BigDecimal ticketModerateurPct,
    Integer delaiCarenceJours,
    String reseauSoins,
    // --- police ---
    String policeStatut,
    LocalDate policeDebut,
    LocalDate policeFin,
    // --- tarif conventionné établissement × acte (v3 §5), nullable : aucun
    // tarif négocié pour ce couple -> comportement inchangé ---
    UUID etablissementId,
    BigDecimal tarifConvention,
    // --- famille et période de cumul (prisma/sql/069) ---
    UUID produitId,
    /** Adhérent titulaire de la famille : l'adhérent lui-même, ou le titulaire du bénéficiaire. */
    UUID titulaireId,
    /** {@code ANNEE_POLICE} | {@code ANNEE_CIVILE} ({@link PeriodeCumul}). */
    String periodeCumul) {

  /** Personne soignée : l'adhérent, sinon le bénéficiaire, sinon (cas non attendu) la police. */
  public UUID clePersonne() {
    return adherentId != null ? adherentId : beneficiaireId != null ? beneficiaireId : policeId;
  }
}
