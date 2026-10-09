package ci.assurance.adjudication.domain;

import java.time.LocalDate;
import java.util.UUID;

/** Convention (VALIDEE, ou ARCHIVEE dont la période court encore) en vigueur à la date des soins. */
public record ConventionApplicable(
    UUID id,
    String numero,
    int version,
    String politiqueDepassement,
    boolean historique,
    LocalDate dateDebut,
    LocalDate dateFin) {}
