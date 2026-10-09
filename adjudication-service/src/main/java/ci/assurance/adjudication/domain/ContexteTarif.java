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
    String typeVisite) {}
