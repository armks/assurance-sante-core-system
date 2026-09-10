package ci.assurance.adjudication.web;

import ci.assurance.adjudication.domain.AdjudicationService;
import ci.assurance.adjudication.web.dto.DecisionResponse;
import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Seul point d'entrée métier. Protégé par {@code ServiceJwtAuthFilter} (JWT de
 * service HMAC) — non joignable sans jeton valide (401).
 */
@RestController
@RequestMapping("/api/v1/adjudication")
public class AdjudicationController {

  private final AdjudicationService service;

  public AdjudicationController(AdjudicationService service) {
    this.service = service;
  }

  @PostMapping("/{reclamationId}/evaluer")
  public DecisionResponse evaluer(@PathVariable UUID reclamationId) {
    return service.evaluer(reclamationId);
  }
}
