package ci.assurance.adjudication.web.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Réponse de {@code POST /api/v1/adjudication/plafonds}. Période : {@code debut} et
 * {@code fin} INCLUSES. Montants restants nuls = pas de plafond de ce niveau.
 */
public record PlafondsResponse(
    @JsonProperty("periode") Periode periode,
    @JsonProperty("garanties") List<Garantie> garanties) {

  public record Periode(
      @JsonProperty("mode") String mode,
      @JsonProperty("debut") LocalDate debut,
      @JsonProperty("fin") LocalDate fin) {}

  public record Garantie(
      @JsonProperty("garantie_id") UUID garantieId,
      @JsonProperty("categorie_acte") String categorieActe,
      @JsonProperty("plafond_personne") BigDecimal plafondPersonne,
      @JsonProperty("plafond_famille") BigDecimal plafondFamille,
      @JsonProperty("consomme_famille") BigDecimal consommeFamille,
      @JsonProperty("restant_famille") BigDecimal restantFamille,
      @JsonProperty("personnes") List<Personne> personnes) {}

  public record Personne(
      @JsonProperty("adherent_id") UUID adherentId,
      @JsonProperty("beneficiaire_id") UUID beneficiaireId,
      @JsonProperty("consomme") BigDecimal consomme,
      @JsonProperty("restant") BigDecimal restant) {}
}
