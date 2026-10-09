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
      @JsonProperty("tarif_conventionne_id") UUID tarifConventionneId,
      @JsonProperty("trace_tarif") Trace trace) {}

  /** Instantané du tarif appliqué (ADR-008, lot 3) — l'appelant le fige sur la ligne de facturation. */
  public record Trace(
      @JsonProperty("statut_tarif") String statutTarif,
      @JsonProperty("regle_origine") String regleOrigine,
      @JsonProperty("lettre_cle") String lettreCle,
      @JsonProperty("coefficient") BigDecimal coefficient,
      @JsonProperty("valeur_appliquee") BigDecimal valeurAppliquee,
      @JsonProperty("convention_id") UUID conventionId,
      @JsonProperty("politique_depassement") String politiqueDepassement,
      @JsonProperty("prix_affiche") BigDecimal prixAffiche,
      @JsonProperty("tarif_reconnu") BigDecimal tarifReconnu,
      @JsonProperty("ecart") BigDecimal ecart,
      @JsonProperty("message") String message,
      @JsonProperty("tarif_unitaire") BigDecimal tarifUnitaire,
      @JsonProperty("quantite") int quantite,
      @JsonProperty("provisoire") boolean provisoire,
      @JsonProperty("tarif_propose_id") UUID tarifProposeId) {}
}
