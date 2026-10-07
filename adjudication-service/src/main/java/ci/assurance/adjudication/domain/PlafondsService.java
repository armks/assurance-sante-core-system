package ci.assurance.adjudication.domain;

import ci.assurance.adjudication.domain.AdjudicationExceptions.DemandeInvalide;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * État des plafonds annuels d'une FAMILLE (titulaire + bénéficiaires), en lecture seule,
 * pour l'affichage à l'adhérent et à sa société (prisma/sql/069). Mêmes cumuls et même
 * période que l'adjudication — le core NestJS n'en recalcule rien.
 */
@Service
public class PlafondsService {

  /** Consommé / restant d'une personne pour une garantie (restant null sans plafond personne). */
  public record EtatPersonne(UUID adherentId, UUID beneficiaireId, BigDecimal consomme, BigDecimal restant) {}

  public record EtatGarantie(
      UUID garantieId,
      String categorieActe,
      BigDecimal plafondPersonne,
      BigDecimal plafondFamille,
      BigDecimal consommeFamille,
      BigDecimal restantFamille,
      List<EtatPersonne> personnes) {}

  public record Etat(PeriodeCumul periode, List<EtatGarantie> garanties) {}

  private final AdjudicationRepository repo;

  public PlafondsService(AdjudicationRepository repo) {
    this.repo = repo;
  }

  @Transactional(readOnly = true)
  public Etat etat(UUID policeId, UUID titulaireId, LocalDate jour) {
    if (policeId == null || titulaireId == null) {
      throw new DemandeInvalide("police_id et adherent_id (titulaire) sont requis.");
    }
    final PoliceApplicable police =
        repo.chargerPolice(policeId)
            .orElseThrow(() -> new DemandeInvalide("Police introuvable : " + policeId));
    final PeriodeCumul periode =
        PeriodeCumul.courante(
            police.periodeCumul(), police.debut(), jour != null ? jour : LocalDate.now(ZoneOffset.UTC));
    final List<UUID> beneficiaires = repo.beneficiairesDe(titulaireId);
    final List<UUID> aucunActe = List.of();

    final List<EtatGarantie> garanties = new ArrayList<>();
    for (GarantieApplicable g : repo.garantiesAvecPlafondAnnuel(police.produitId())) {
      final List<EtatPersonne> personnes = new ArrayList<>();
      personnes.add(etatPersonne(g, titulaireId, null, periode));
      for (UUID b : beneficiaires) {
        personnes.add(etatPersonne(g, null, b, periode));
      }
      BigDecimal consommeFamille = null;
      BigDecimal restantFamille = null;
      if (g.plafondAnnuelFamille() != null) {
        consommeFamille = repo.sommeConsommeeFamille(titulaireId, g.id(), aucunActe, periode);
        restantFamille = restant(g.plafondAnnuelFamille(), consommeFamille);
      }
      garanties.add(
          new EtatGarantie(
              g.id(),
              g.categorieActe(),
              g.plafondAnnuelPersonne(),
              g.plafondAnnuelFamille(),
              echelle(consommeFamille),
              restantFamille,
              personnes));
    }
    return new Etat(periode, garanties);
  }

  private EtatPersonne etatPersonne(
      GarantieApplicable g, UUID adherentId, UUID beneficiaireId, PeriodeCumul periode) {
    final BigDecimal consomme =
        repo.sommeConsommeePersonne(adherentId, beneficiaireId, g.id(), List.of(), periode);
    return new EtatPersonne(
        adherentId,
        beneficiaireId,
        echelle(consomme),
        g.plafondAnnuelPersonne() == null ? null : restant(g.plafondAnnuelPersonne(), consomme));
  }

  private static BigDecimal restant(BigDecimal plafond, BigDecimal consomme) {
    return plafond.subtract(consomme).max(BigDecimal.ZERO).setScale(Adjudicateur.ECHELLE, Adjudicateur.ARRONDI);
  }

  private static BigDecimal echelle(BigDecimal v) {
    return v == null ? null : v.setScale(Adjudicateur.ECHELLE, Adjudicateur.ARRONDI);
  }
}
