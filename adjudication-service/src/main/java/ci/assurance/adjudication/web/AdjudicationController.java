package ci.assurance.adjudication.web;

import ci.assurance.adjudication.domain.AdjudicationService;
import ci.assurance.adjudication.domain.PlafondsService;
import ci.assurance.adjudication.domain.SimulationService;
import ci.assurance.adjudication.web.dto.DecisionResponse;
import ci.assurance.adjudication.web.dto.PlafondsRequest;
import ci.assurance.adjudication.web.dto.PlafondsResponse;
import ci.assurance.adjudication.web.dto.SimulationRequest;
import ci.assurance.adjudication.web.dto.SimulationResponse;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Points d'entrée métier. Protégés par {@code ServiceJwtAuthFilter} (JWT de
 * service HMAC) — non joignables sans jeton valide (401).
 */
@RestController
@RequestMapping("/api/v1/adjudication")
public class AdjudicationController {

  private final AdjudicationService service;
  private final SimulationService simulation;
  private final PlafondsService plafonds;

  public AdjudicationController(
      AdjudicationService service, SimulationService simulation, PlafondsService plafonds) {
    this.service = service;
    this.simulation = simulation;
    this.plafonds = plafonds;
  }

  /**
   * État des plafonds annuels d'une famille (titulaire + bénéficiaires), sans écriture
   * (prisma/sql/069) : par garantie plafonnée, consommé et restant par personne et pour
   * la famille, sur la période de cumul en cours. Affiché à l'adhérent et à sa société.
   */
  @PostMapping("/plafonds")
  public PlafondsResponse plafonds(@RequestBody PlafondsRequest req) {
    final PlafondsService.Etat e =
        plafonds.etat(req.policeId(), req.adherentId(), req.dateReference());
    return new PlafondsResponse(
        new PlafondsResponse.Periode(
            e.periode().mode(), e.periode().debut(), e.periode().finExclue().minusDays(1)),
        e.garanties().stream()
            .map(g -> new PlafondsResponse.Garantie(
                g.garantieId(), g.categorieActe(), g.plafondPersonne(), g.plafondFamille(),
                g.consommeFamille(), g.restantFamille(),
                g.personnes().stream()
                    .map(p -> new PlafondsResponse.Personne(
                        p.adherentId(), p.beneficiaireId(), p.consomme(), p.restant()))
                    .toList()))
            .toList());
  }

  @PostMapping("/{reclamationId}/evaluer")
  public DecisionResponse evaluer(@PathVariable UUID reclamationId) {
    return service.evaluer(reclamationId);
  }

  /**
   * Part assurance calculée SANS écriture (ADR-005) — même règle et même cumul
   * annuel que {@code evaluer}. Utilisé par le core pour la simulation, la facture
   * tiers payant et le comptoir pharmacie.
   */
  @PostMapping("/simuler")
  public SimulationResponse simuler(@RequestBody SimulationRequest req) {
    final List<SimulationService.Ligne> lignes =
        req.lignes() == null
            ? List.of()
            : req.lignes().stream()
                .map(l -> new SimulationService.Ligne(
                    l.garantieId(), l.montant(), l.codeActe(), l.acteDossierId(), l.dateSoins()))
                .toList();
    final List<SimulationService.ResultatLigne> r =
        simulation.simuler(
            new SimulationService.Demande(
                req.policeId(), req.adherentId(), req.beneficiaireId(),
                req.etablissementId(), req.dateReference(), lignes));
    return new SimulationResponse(
        r.stream()
            .map(x -> new SimulationResponse.Ligne(
                x.decision().name(), x.montantCouvert(), x.plafondRestantApres(), x.codesRejet()))
            .toList());
  }
}
