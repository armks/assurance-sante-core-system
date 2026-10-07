package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ci.assurance.adjudication.domain.AdjudicationRepository;
import ci.assurance.adjudication.domain.AdjudicationService;
import ci.assurance.adjudication.domain.ContexteAdjudication;
import ci.assurance.adjudication.domain.GarantieApplicable;
import ci.assurance.adjudication.domain.PeriodeCumul;
import ci.assurance.adjudication.domain.PoliceApplicable;
import ci.assurance.adjudication.domain.SimulationService;
import ci.assurance.adjudication.domain.SimulationService.Demande;
import ci.assurance.adjudication.domain.SimulationService.Ligne;
import ci.assurance.adjudication.domain.SimulationService.ResultatLigne;
import ci.assurance.adjudication.web.dto.DecisionResponse;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Période de cumul déterminée par la DATE DES SOINS (prisma/sql/070), pas par la date de
 * la réclamation ni par celle du jour — cas à cheval sur l'anniversaire de la police et sur
 * le 1er janvier. Montants exacts.
 *
 * <p>Garantie de référence : acte de 25 000, franchise 2 000, taux 80 % → 18 400 avant
 * plafond annuel ; plafond annuel par personne 30 000. Dans chaque cas, la période des soins
 * a DÉJÀ 25 000 de consommés (reste 5 000) et la période suivante rien : le montant
 * remboursé dit donc quelle période a été retenue.
 */
class DateSoinsCumulTest {

  private static final UUID ID = JeuDeDonneesReference.RECLAMATION_ID;
  private static final BigDecimal DEJA_CONSOMME = new BigDecimal("25000.00");

  /** Réclamation : produit en {@code mode}, police commencée le {@code debutPolice}. */
  private static ContexteAdjudication reclamation(
      String mode, LocalDate debutPolice, LocalDate dateSoins, LocalDate dateReclamation) {
    ContexteAdjudication c = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));
    return new ContexteAdjudication(
        c.id(), c.organisationId(), c.dossierSoinsId(), c.acteDossierId(),
        c.adherentId(), c.beneficiaireId(), c.policeId(), c.garantieId(),
        c.montant(), c.typeReclamation(), c.statut(),
        dateReclamation.atStartOfDay(ZoneOffset.UTC).toInstant(),
        c.tauxCouverturePct(), c.plafondParActe(),
        new BigDecimal("30000.00"), null, c.franchise(),
        c.ticketModerateurPct(), c.delaiCarenceJours(), c.reseauSoins(),
        c.policeStatut(), debutPolice, null,
        c.etablissementId(), c.tarifConvention(),
        c.produitId(), c.titulaireId(), mode, dateSoins, 90);
  }

  /** Adjudique : la période des soins attendue a déjà 25 000 consommés, toute autre 0. */
  private DecisionResponse adjuger(ContexteAdjudication ctx, PeriodeCumul periodeDesSoins, AdjudicationRepository repo) {
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(BigDecimal.ZERO);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), eq(periodeDesSoins))).thenReturn(DEJA_CONSOMME);
    when(repo.insererRemboursement(any(), any(), any(), any(), anyLong())).thenReturn(UUID.randomUUID());
    when(repo.majStatut(eq(ID), any())).thenReturn(1);
    return new AdjudicationService(repo).evaluer(ID);
  }

  private static PeriodeCumul periode(String mode, String debut, String finExclue) {
    return new PeriodeCumul(mode, LocalDate.parse(debut), LocalDate.parse(finExclue));
  }

  @Test
  @DisplayName("Année de police (début 01/03/2025) : soins du 20/02/2026 réclamés le 10/03/2026 → période 2025-2026, reste 5000.00")
  void soinsAvantAnniversaireReclamesApres() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    PeriodeCumul ancienne = periode("ANNEE_POLICE", "2025-03-01", "2026-03-01");
    DecisionResponse r = adjuger(
        reclamation("ANNEE_POLICE", LocalDate.of(2025, 3, 1), LocalDate.of(2026, 2, 20), LocalDate.of(2026, 3, 10)),
        ancienne, repo);
    assertThat(r.montantRembourse()).isEqualByComparingTo("5000.00");
    assertThat(r.codesRejet()).containsExactly("E006");
    verify(repo, never()).sommeConsommeePersonne(any(), any(), any(), any(),
        eq(periode("ANNEE_POLICE", "2026-03-01", "2027-03-01")));
  }

  @Test
  @DisplayName("Année de police : soins du 02/03/2026 (après l'anniversaire) → nouvelle période vierge, 18400.00")
  void soinsApresAnniversaire() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    // la période 2025-2026 est pleine ; les soins tombent dans 2026-2027
    DecisionResponse r = adjuger(
        reclamation("ANNEE_POLICE", LocalDate.of(2025, 3, 1), LocalDate.of(2026, 3, 2), LocalDate.of(2026, 3, 10)),
        periode("ANNEE_POLICE", "2025-03-01", "2026-03-01"), repo);
    assertThat(r.montantRembourse()).isEqualByComparingTo("18400.00");
    assertThat(r.codesRejet()).isEmpty();
    verify(repo).sommeConsommeePersonne(any(), any(), any(), any(),
        eq(periode("ANNEE_POLICE", "2026-03-01", "2027-03-01")));
  }

  @Test
  @DisplayName("Police commencée un 29/02/2024 : soins du 27/02/2026 → période 28/02/2025-27/02/2026, reste 5000.00")
  void vingtNeufFevrierVeille() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    DecisionResponse r = adjuger(
        reclamation("ANNEE_POLICE", LocalDate.of(2024, 2, 29), LocalDate.of(2026, 2, 27), LocalDate.of(2026, 3, 3)),
        periode("ANNEE_POLICE", "2025-02-28", "2026-02-28"), repo);
    assertThat(r.montantRembourse()).isEqualByComparingTo("5000.00");
  }

  @Test
  @DisplayName("Police commencée un 29/02/2024 : soins du 28/02/2026, jour anniversaire → nouvelle période, 18400.00")
  void vingtNeufFevrierJourAnniversaire() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    DecisionResponse r = adjuger(
        reclamation("ANNEE_POLICE", LocalDate.of(2024, 2, 29), LocalDate.of(2026, 2, 28), LocalDate.of(2026, 3, 3)),
        periode("ANNEE_POLICE", "2025-02-28", "2026-02-28"), repo);
    assertThat(r.montantRembourse()).isEqualByComparingTo("18400.00");
    verify(repo).sommeConsommeePersonne(any(), any(), any(), any(),
        eq(periode("ANNEE_POLICE", "2026-02-28", "2027-02-28")));
  }

  @Test
  @DisplayName("Année civile : soins du 28/12/2025 réclamés le 05/01/2026 → année 2025, reste 5000.00")
  void anneeCivileDecembreReclameEnJanvier() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    DecisionResponse r = adjuger(
        reclamation("ANNEE_CIVILE", LocalDate.of(2025, 1, 1), LocalDate.of(2025, 12, 28), LocalDate.of(2026, 1, 5)),
        periode("ANNEE_CIVILE", "2025-01-01", "2026-01-01"), repo);
    assertThat(r.montantRembourse()).isEqualByComparingTo("5000.00");
    assertThat(r.codesRejet()).containsExactly("E006");
  }

  @Test
  @DisplayName("Date des soins inconnue → à défaut la date de la réclamation (comportement antérieur)")
  void sansDateDeSoins() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    DecisionResponse r = adjuger(
        reclamation("ANNEE_CIVILE", LocalDate.of(2025, 1, 1), null, LocalDate.of(2026, 1, 5)),
        periode("ANNEE_CIVILE", "2026-01-01", "2027-01-01"), repo);
    assertThat(r.montantRembourse()).isEqualByComparingTo("5000.00");
  }

  @Test
  @DisplayName("Facture à cheval sur l'anniversaire : chaque acte consomme SA période — 5000, 10000, puis 0 (ancienne période épuisée)")
  void factureAChevalSurLAnniversaire() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    UUID police = UUID.randomUUID();
    UUID produit = UUID.randomUUID();
    UUID adherent = UUID.randomUUID();
    UUID g = UUID.randomUUID();
    when(repo.chargerPolice(police)).thenReturn(Optional.of(new PoliceApplicable(
        police, UUID.randomUUID(), produit, "ACTIVE", LocalDate.of(2025, 3, 1), null, "ANNEE_POLICE", 90)));
    when(repo.chargerGarantie(g)).thenReturn(Optional.of(new GarantieApplicable(
        g, produit, "CONSULTATION", new BigDecimal("100"), null, new BigDecimal("30000.00"), null,
        null, null, 0, "TOUT_RESEAU")));
    when(repo.titulaireDe(adherent, null)).thenReturn(adherent);
    PeriodeCumul ancienne = periode("ANNEE_POLICE", "2025-03-01", "2026-03-01");
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(BigDecimal.ZERO);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), eq(ancienne))).thenReturn(DEJA_CONSOMME);

    // facture établie le 10/03/2026 (horloge fixe : test indépendant du jour d'exécution)
    List<ResultatLigne> r = new SimulationService(repo, java.time.Clock.fixed(
        java.time.Instant.parse("2026-03-10T12:00:00Z"), ZoneOffset.UTC)).simuler(new Demande(
        police, adherent, null, null, LocalDate.of(2026, 3, 10), List.of(
            new Ligne(g, new BigDecimal("10000"), null, null, LocalDate.of(2026, 2, 25)),
            new Ligne(g, new BigDecimal("10000"), null, null, LocalDate.of(2026, 3, 5)),
            new Ligne(g, new BigDecimal("10000"), null, null, LocalDate.of(2026, 2, 26)))));

    assertThat(r).extracting(ResultatLigne::montantCouvert)
        .usingComparatorForType(BigDecimal::compareTo, BigDecimal.class)
        .containsExactly(new BigDecimal("5000.00"), new BigDecimal("10000.00"), new BigDecimal("0.00"));
  }
}
