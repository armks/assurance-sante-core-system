package ci.assurance.adjudication.web.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Corps de {@code POST /api/v1/adjudication/plafonds} : état des plafonds annuels d'une
 * famille. {@code adherent_id} = le TITULAIRE ; {@code date_reference} optionnelle
 * (aujourd'hui par défaut) choisit la période de cumul.
 */
public record PlafondsRequest(
    @JsonProperty("police_id") UUID policeId,
    @JsonProperty("adherent_id") UUID adherentId,
    @JsonProperty("date_reference") LocalDate dateReference) {}
