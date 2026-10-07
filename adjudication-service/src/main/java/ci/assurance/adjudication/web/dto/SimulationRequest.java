package ci.assurance.adjudication.web.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Corps de {@code POST /api/v1/adjudication/simuler} (ADR-005). Noms JSON en
 * {@code snake_case}, comme le contrat d'adjudication.
 */
public record SimulationRequest(
    @JsonProperty("police_id") UUID policeId,
    @JsonProperty("adherent_id") UUID adherentId,
    @JsonProperty("beneficiaire_id") UUID beneficiaireId,
    @JsonProperty("etablissement_id") UUID etablissementId,
    @JsonProperty("date_reference") LocalDate dateReference,
    @JsonProperty("lignes") List<Ligne> lignes) {

  public record Ligne(
      @JsonProperty("garantie_id") UUID garantieId,
      @JsonProperty("montant") BigDecimal montant,
      @JsonProperty("code_acte") String codeActe,
      @JsonProperty("acte_dossier_id") UUID acteDossierId,
      @JsonProperty("date_soins") LocalDate dateSoins) {}
}
