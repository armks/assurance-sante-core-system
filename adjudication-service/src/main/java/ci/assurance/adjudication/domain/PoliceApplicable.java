package ci.assurance.adjudication.domain;

import java.time.LocalDate;
import java.util.UUID;

/** Police lue pour une simulation : éligibilité à la date des soins. */
public record PoliceApplicable(
    UUID id, UUID organisationId, UUID produitId, String statut, LocalDate debut, LocalDate fin) {
}
