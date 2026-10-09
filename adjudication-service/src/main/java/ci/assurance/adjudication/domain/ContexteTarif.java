package ci.assurance.adjudication.domain;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Ce qu'il faut savoir d'un acte pour résoudre son tarif : organisation (isolation), établissement, acte du
 * référentiel (identifiant, à défaut code d'acte), date des soins et type de visite du dossier (contexte).
 */
public record ContexteTarif(
    UUID organisationId,
    UUID etablissementId,
    UUID referentielActeId,
    String codeActe,
    LocalDate dateSoins,
    String typeVisite,
    /** Acte de dossier (cherche son éventuel tarif proposé) ; {@code null} hors dossier de soins. */
    UUID acteDossierId,
    /** Quantité de l'acte : le tarif reconnu de la ligne = tarif unitaire × quantité. */
    int quantite,
    /**
     * Décision de tarif proposé IMPOSÉE par l'appelant (recalcul d'une décision encore non validée en base, sous le même
     * verrou que la décision) ; {@code null} : le tarif proposé est lu en base.
     */
    AdjudicationRepository.TarifProposeActe tarifProposeImpose) {

  public ContexteTarif(UUID organisationId, UUID etablissementId, UUID referentielActeId, String codeActe,
      LocalDate dateSoins, String typeVisite, UUID acteDossierId, int quantite) {
    this(organisationId, etablissementId, referentielActeId, codeActe, dateSoins, typeVisite, acteDossierId, quantite, null);
  }

  /** Forme historique : un acte, quantité 1, sans tarif proposé. */
  public ContexteTarif(UUID organisationId, UUID etablissementId, UUID referentielActeId, String codeActe,
      LocalDate dateSoins, String typeVisite) {
    this(organisationId, etablissementId, referentielActeId, codeActe, dateSoins, typeVisite, null, 1, null);
  }
}
