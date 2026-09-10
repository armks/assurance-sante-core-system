package ci.assurance.adjudication.web.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.util.List;

/**
 * Décision structurée renvoyée par {@code POST /api/v1/adjudication/{id}/evaluer}
 * (v12 §3). Noms JSON en {@code snake_case} — imposés par le contrat.
 */
public record DecisionResponse(
    @JsonProperty("decision") String decision,
    @JsonProperty("montant_rembourse") BigDecimal montantRembourse,
    @JsonProperty("codes_rejet") List<String> codesRejet,
    @JsonProperty("plafond_restant_apres") BigDecimal plafondRestantApres,
    @JsonProperty("duree_traitement_ms") long dureeTraitementMs) {
}
