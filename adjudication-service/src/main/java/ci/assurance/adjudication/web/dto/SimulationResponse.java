package ci.assurance.adjudication.web.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** Réponse de {@code POST /api/v1/adjudication/simuler} : une entrée par ligne, dans l'ordre. */
public record SimulationResponse(@JsonProperty("lignes") List<Ligne> lignes) {

  public record Ligne(
      @JsonProperty("decision") String decision,
      @JsonProperty("montant_couvert") BigDecimal montantCouvert,
      @JsonProperty("plafond_restant_apres") BigDecimal plafondRestantApres,
      @JsonProperty("codes_rejet") List<String> codesRejet,
      @JsonProperty("tarif_conventionne_id") UUID tarifConventionneId) {}
}
