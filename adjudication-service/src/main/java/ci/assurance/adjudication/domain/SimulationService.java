package ci.assurance.adjudication.domain;

import ci.assurance.adjudication.domain.AdjudicationExceptions.DemandeInvalide;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Calcul de la part assurance SANS écriture (ADR-005) : le core NestJS l'appelle
 * pour la simulation à l'ajout d'un acte, la facture d'un dossier (tiers payant)
 * et le comptoir pharmacie. Même règle que l'adjudication — {@link
 * Adjudicateur#calculer} (tarif conventionné, éligibilité police, franchise, taux,
 * plafond par acte, plafonds annuels par personne et par famille) et mêmes cumuls
 * ({@link AdjudicationRepository#sommeConsommeePersonne},
 * {@link AdjudicationRepository#sommeConsommeeFamille}) sur la même période
 * ({@link PeriodeCumul}) : une seule implémentation des règles financières.
 *
 * <p>Les lignes sont évaluées DANS L'ORDRE : chaque ligne consomme les plafonds
 * annuels (personne et famille) de sa garantie pour les lignes suivantes de la même
 * demande (plusieurs actes d'une même facture). Aucun verrou ni écriture : le résultat est le montant
 * à facturer / à afficher ; l'adjudication d'une réclamation recalcule sous verrou.
 */
@Service
public class SimulationService {

  /**
   * Une ligne à évaluer : garantie applicable (déjà résolue par catégorie), montant
   * brut, code d'acte (tarif conventionné), acte de dossier (ses lignes de
   * facturation déjà en base sont exclues du cumul : il est en cours de
   * (re)facturation), date des soins (éligibilité, tarif ; à défaut celle de la
   * demande).
   */
  public record Ligne(
      UUID garantieId, BigDecimal montant, String codeActe, UUID acteDossierId, LocalDate dateSoins) {

    public Ligne(UUID garantieId, BigDecimal montant, String codeActe) {
      this(garantieId, montant, codeActe, null, null);
    }
  }

  /** Personne soignée (titulaire OU bénéficiaire), police, établissement, date des soins. */
  public record Demande(
      UUID policeId,
      UUID adherentId,
      UUID beneficiaireId,
      UUID etablissementId,
      LocalDate dateReference,
      List<Ligne> lignes) {}

  /**
   * Résultat d'une ligne ; {@code tarifConventionneId} = tarif conventionné appliqué au
   * calcul (null si aucun) — l'appelant le trace sur l'acte (prisma/sql/074).
   */
  public record ResultatLigne(
      Decision decision,
      BigDecimal montantCouvert,
      BigDecimal plafondRestantApres,
      List<String> codesRejet,
      UUID tarifConventionneId) {}

  private final AdjudicationRepository repo;
  private final Adjudicateur adjudicateur = new Adjudicateur();
  /** Horloge : la facture est déclarée « aujourd'hui » (injectable pour les tests). */
  private final Clock horloge;

  @Autowired
  public SimulationService(AdjudicationRepository repo) {
    this(repo, Clock.systemUTC());
  }

  public SimulationService(AdjudicationRepository repo, Clock horloge) {
    this.repo = repo;
    this.horloge = horloge;
  }

  @Transactional(readOnly = true)
  public List<ResultatLigne> simuler(Demande d) {
    if (d.policeId() == null || d.lignes() == null || d.lignes().isEmpty()) {
      throw new DemandeInvalide("police_id et au moins une ligne sont requis.");
    }
    if (d.adherentId() != null && d.beneficiaireId() != null) {
      throw new DemandeInvalide("adherent_id et beneficiaire_id sont mutuellement exclusifs.");
    }
    final PoliceApplicable police =
        repo.chargerPolice(d.policeId())
            .orElseThrow(() -> new DemandeInvalide("Police introuvable : " + d.policeId()));
    // la facture (ou la simulation) est déclarée aujourd'hui : bornes « soins futurs »
    // et « délai après la fin de la police », exactement comme une réclamation
    final LocalDate aujourdhui = LocalDate.now(horloge);
    final LocalDate dateDemande = d.dateReference() != null ? d.dateReference() : aujourdhui;
    final List<UUID> actesExclus =
        d.lignes().stream().map(Ligne::acteDossierId).filter(java.util.Objects::nonNull).toList();

    final UUID titulaire = repo.titulaireDe(d.adherentId(), d.beneficiaireId());

    // cumuls courants par (garantie, période) : base (déjà consommé) + lignes déjà
    // évaluées. La période est celle qui contient la DATE DES SOINS de chaque ligne
    // (prisma/sql/070) : une facture peut porter sur des actes de part et d'autre de
    // l'anniversaire de la police, chacun consomme sa propre période.
    final Map<String, BigDecimal> cumulPersonne = new HashMap<>();
    final Map<String, BigDecimal> cumulFamille = new HashMap<>();
    final List<ResultatLigne> resultats = new ArrayList<>();
    for (Ligne l : d.lignes()) {
      if (l.garantieId() == null || l.montant() == null || l.montant().signum() < 0) {
        throw new DemandeInvalide("Chaque ligne exige garantie_id et un montant positif ou nul.");
      }
      final GarantieApplicable g =
          repo.chargerGarantie(l.garantieId())
              .orElseThrow(() -> new DemandeInvalide("Garantie introuvable : " + l.garantieId()));
      if (!g.produitId().equals(police.produitId())) {
        throw new DemandeInvalide(
            "La garantie " + g.id() + " n'appartient pas au produit de la police " + police.id() + ".");
      }
      final LocalDate date = l.dateSoins() != null ? l.dateSoins() : dateDemande;
      final PeriodeCumul periode =
          PeriodeCumul.courante(police.periodeCumul(), police.debut(), date);
      final String cle = g.id() + "|" + periode.debut();
      final BigDecimal dejaPersonne =
          cumulPersonne.computeIfAbsent(
              cle,
              k -> g.plafondAnnuelPersonne() == null
                  ? BigDecimal.ZERO
                  : repo.sommeConsommeePersonne(
                      d.adherentId(), d.beneficiaireId(), g.id(), actesExclus, periode));
      final BigDecimal dejaFamille =
          cumulFamille.computeIfAbsent(
              cle,
              k -> g.plafondAnnuelFamille() == null
                  ? BigDecimal.ZERO
                  : repo.sommeConsommeeFamille(titulaire, g.id(), actesExclus, periode));

      final BigDecimal tarif = repo.tarifConvention(d.etablissementId(), l.codeActe(), date);
      final UUID tarifId =
          tarif == null ? null : repo.tarifConventionneId(d.etablissementId(), l.codeActe(), date);
      final ContexteAdjudication ctx =
          new ContexteAdjudication(
              null, police.organisationId(), null, null,
              d.adherentId(), d.beneficiaireId(), police.id(), g.id(),
              l.montant(), null, null, date.atStartOfDay(ZoneOffset.UTC).toInstant(),
              g.tauxCouverturePct(), g.plafondParActe(),
              g.plafondAnnuelPersonne(), g.plafondAnnuelFamille(), g.franchise(),
              g.ticketModerateurPct(), g.delaiCarenceJours(), g.reseauSoins(),
              police.statut(), police.debut(), police.fin(),
              d.etablissementId(), tarif,
              g.produitId(), titulaire, police.periodeCumul(), date,
              police.delaiDeclarationJours());

      final Adjudicateur.Resultat r =
          adjudicateur.calculer(ctx, dejaPersonne, dejaFamille, aujourdhui);
      cumulPersonne.put(cle, dejaPersonne.add(r.montantRembourse()));
      cumulFamille.put(cle, dejaFamille.add(r.montantRembourse()));
      resultats.add(
          new ResultatLigne(
              r.decision(), r.montantRembourse(), r.plafondRestantApres(), r.codesRejet(), tarifId));
    }
    return resultats;
  }
}
