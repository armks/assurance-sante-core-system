package ci.assurance.adjudication.domain;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Police lue pour une simulation ou l'état des plafonds : éligibilité à la date des soins,
 * et période de cumul des plafonds annuels de son produit ({@code produits.periode_cumul_plafond}).
 */
public record PoliceApplicable(
    UUID id,
    UUID organisationId,
    UUID produitId,
    String statut,
    LocalDate debut,
    LocalDate fin,
    String periodeCumul,
    /** Délai de déclaration après la fin de la police (prisma/sql/071). */
    Integer delaiDeclarationJours) {
}
