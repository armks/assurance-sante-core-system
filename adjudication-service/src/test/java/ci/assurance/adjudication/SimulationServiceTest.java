package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ci.assurance.adjudication.domain.AdjudicationExceptions.DemandeInvalide;
import ci.assurance.adjudication.domain.AdjudicationRepository;
import ci.assurance.adjudication.domain.Decision;
import ci.assurance.adjudication.domain.GarantieApplicable;
import ci.assurance.adjudication.domain.PeriodeCumul;
import ci.assurance.adjudication.domain.PoliceApplicable;
import ci.assurance.adjudication.domain.SimulationService;
import ci.assurance.adjudication.domain.SimulationService.Demande;
import ci.assurance.adjudication.domain.SimulationService.Ligne;
import ci.assurance.adjudication.domain.SimulationService.ResultatLigne;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Simulation SANS écriture (ADR-005) — même règle que l'adjudication. Montants
 * exacts (zéro tolérance). Les cas par catégorie reprennent les exemples de
 * l'analyse du 2026-10-07 ; la règle « non couvert » (aucune garantie) reste au
 * core NestJS, qui n'appelle pas ce service dans ce cas.
 */
class SimulationServiceTest {

  private static final UUID POLICE = UUID.fromString("33333333-3333-4333-8333-333333333333");
  private static final UUID PRODUIT = UUID.fromString("77777777-7777-4777-8777-777777777777");
  private static final UUID ADHERENT = UUID.fromString("22222222-2222-4222-8222-222222222222");
  private static final UUID ETAB = UUID.fromString("55555555-5555-4555-8555-555555555555");
  private static final UUID BENEFICIAIRE = UUID.fromString("66666666-6666-4666-8666-666666666666");
  private static final LocalDate DATE = LocalDate.of(2026, 6, 15);
  /** Période du produit de test (année civile) contenant la date des soins {@link #DATE}. */
  private static final PeriodeCumul PERIODE = PeriodeCumul.courante("ANNEE_CIVILE", null, DATE);

  private AdjudicationRepository repo;
  private SimulationService service;

  @BeforeEach
  void init() {
    repo = mock(AdjudicationRepository.class);
    // facture établie le 20/06/2026 (horloge fixe : test indépendant du jour d'exécution)
    service = new SimulationService(repo, java.time.Clock.fixed(
        java.time.Instant.parse("2026-06-20T12:00:00Z"), ZoneOffset.UTC));
    when(repo.chargerPolice(POLICE)).thenReturn(Optional.of(
        new PoliceApplicable(POLICE, UUID.randomUUID(), PRODUIT, "ACTIVE",
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), "ANNEE_CIVILE", 90)));
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(new BigDecimal("0.00"));
    when(repo.sommeConsommeeFamille(any(), any(), any(), any())).thenReturn(new BigDecimal("0.00"));
    when(repo.titulaireDe(ADHERENT, null)).thenReturn(ADHERENT);
    when(repo.titulaireDe(null, BENEFICIAIRE)).thenReturn(ADHERENT);
  }

  private UUID garantie(String taux, String plafondActe, String plafondAnnuel, String franchise) {
    return garantie(taux, plafondActe, plafondAnnuel, null, franchise);
  }

  /** Garantie avec plafonds annuels par personne et par famille (chacun nullable). */
  private UUID garantie(
      String taux, String plafondActe, String plafondPersonne, String plafondFamille, String franchise) {
    UUID id = UUID.randomUUID();
    when(repo.chargerGarantie(id)).thenReturn(Optional.of(new GarantieApplicable(
        id, PRODUIT, "CONSULTATION", new BigDecimal(taux),
        plafondActe == null ? null : new BigDecimal(plafondActe),
        plafondPersonne == null ? null : new BigDecimal(plafondPersonne),
        plafondFamille == null ? null : new BigDecimal(plafondFamille),
        franchise == null ? null : new BigDecimal(franchise),
        null, 0, "TOUT_RESEAU")));
    return id;
  }

  private List<ResultatLigne> simuler(Ligne... lignes) {
    return service.simuler(new Demande(POLICE, ADHERENT, null, ETAB, DATE, List.of(lignes)));
  }

  @ParameterizedTest(name = "{0} : {1} F à {2} % (plafond acte {3}) → {4}")
  @CsvSource({
      "CONSULTATION,     10000,   80,  ,       8000.00",
      "HOSPITALISATION,  1200000, 100, ,       1200000.00",
      "MATERNITE,        400000,  100, 300000, 300000.00",
      "PHARMACIE,        20000,   80,  ,       16000.00",
      "ANALYSES,         60000,   70,  40000,  40000.00",
      "IMAGERIE,         50000,   70,  ,       35000.00",
      "DENTAIRE,         30000,   60,  ,       18000.00",
      "SOINS_INFIRMIERS, 5000,    90,  ,       4500.00",
      "TRANSPORT,        80000,   50,  25000,  25000.00",
  })
  @DisplayName("Part assurance par catégorie couverte (exemples de l'analyse)")
  void parCategorie(String categorie, String montant, String taux, String plafondActe, String attendu) {
    UUID g = garantie(taux, plafondActe, null, null);
    ResultatLigne r = simuler(new Ligne(g, new BigDecimal(montant), null)).get(0);
    assertThat(r.montantCouvert()).isEqualByComparingTo(attendu);
  }

  @Test
  @DisplayName("Franchise déduite avant le taux : (10000 − 1000) × 80 % = 7200.00")
  void franchise() {
    UUID g = garantie("80", null, null, "1000");
    assertThat(simuler(new Ligne(g, new BigDecimal("10000"), null)).get(0).montantCouvert())
        .isEqualByComparingTo("7200.00");
  }

  @Test
  @DisplayName("Facture de 3 actes : chaque ligne consomme le plafond annuel (20000) pour la suivante — 7200, 7200, 5600")
  void plafondAnnuelConsommeLigneParLigne() {
    UUID g = garantie("80", null, "20000", "1000");
    List<ResultatLigne> r = simuler(
        new Ligne(g, new BigDecimal("10000"), null),
        new Ligne(g, new BigDecimal("10000"), null),
        new Ligne(g, new BigDecimal("10000"), null));
    assertThat(r).extracting(ResultatLigne::montantCouvert)
        .usingComparatorForType(BigDecimal::compareTo, BigDecimal.class)
        .containsExactly(new BigDecimal("7200.00"), new BigDecimal("7200.00"), new BigDecimal("5600.00"));
    assertThat(r.get(1).plafondRestantApres()).isEqualByComparingTo("5600.00");
    assertThat(r.get(2).plafondRestantApres()).isEqualByComparingTo("0.00");
    assertThat(r.get(2).decision()).isEqualTo(Decision.REVUE_MANUELLE);
    assertThat(r.get(2).codesRejet()).containsExactly("E006");
  }

  @Test
  @DisplayName("Cumul déjà consommé lu dans la base (remboursements + tiers payant) : 15000 sur 20000 → 5000.00")
  void cumulDeBase() {
    UUID g = garantie("80", null, "20000", null);
    when(repo.sommeConsommeePersonne(ADHERENT, null, g, java.util.List.of(), PERIODE)).thenReturn(new BigDecimal("15000.00"));
    ResultatLigne r = simuler(new Ligne(g, new BigDecimal("10000"), null)).get(0);
    assertThat(r.montantCouvert()).isEqualByComparingTo("5000.00");
    verify(repo).sommeConsommeePersonne(ADHERENT, null, g, java.util.List.of(), PERIODE);
  }

  @Test
  @DisplayName("Les actes de la demande sont exclus du cumul (ligne orpheline réattachée non comptée deux fois)")
  void actesDeLaDemandeExclusDuCumul() {
    UUID g = garantie("80", null, "20000", null);
    UUID acte = UUID.randomUUID();
    service.simuler(new Demande(POLICE, ADHERENT, null, ETAB, DATE,
        List.of(new Ligne(g, new BigDecimal("10000"), null, acte, LocalDate.of(2026, 6, 1)))));
    verify(repo).sommeConsommeePersonne(ADHERENT, null, g, List.of(acte), PERIODE);
  }

  @Test
  @DisplayName("Date des soins par ligne : police échue à cette date → REJETE E001")
  void dateDeSoinsParLigne() {
    when(repo.chargerPolice(POLICE)).thenReturn(Optional.of(
        new PoliceApplicable(POLICE, UUID.randomUUID(), PRODUIT, "ACTIVE",
            LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 31), "ANNEE_CIVILE", 90)));
    UUID g = garantie("80", null, null, null);
    ResultatLigne r = service.simuler(new Demande(POLICE, ADHERENT, null, ETAB, DATE,
        List.of(new Ligne(g, new BigDecimal("10000"), null, null, LocalDate.of(2026, 5, 2))))).get(0);
    assertThat(r.decision()).isEqualTo(Decision.REJETE);
    assertThat(r.codesRejet()).containsExactly("E001");
  }

  @Test
  @DisplayName("Deux garanties : cumuls indépendants")
  void garantiesIndependantes() {
    UUID consultation = garantie("80", null, "8000", null);
    UUID analyses = garantie("80", null, "100000", null);
    List<ResultatLigne> r = simuler(
        new Ligne(consultation, new BigDecimal("10000"), null),
        new Ligne(analyses, new BigDecimal("10000"), null));
    assertThat(r.get(0).montantCouvert()).isEqualByComparingTo("8000.00");
    assertThat(r.get(1).montantCouvert()).isEqualByComparingTo("8000.00");
    assertThat(r.get(1).plafondRestantApres()).isEqualByComparingTo("92000.00");
  }

  @Test
  @DisplayName("Police non active → REJETE E001, 0.00")
  void policeInactive() {
    when(repo.chargerPolice(POLICE)).thenReturn(Optional.of(
        new PoliceApplicable(POLICE, UUID.randomUUID(), PRODUIT, "SUSPENDUE", null, null, "ANNEE_CIVILE", 90)));
    UUID g = garantie("80", null, null, null);
    ResultatLigne r = simuler(new Ligne(g, new BigDecimal("10000"), null)).get(0);
    assertThat(r.decision()).isEqualTo(Decision.REJETE);
    assertThat(r.montantCouvert()).isEqualByComparingTo("0.00");
    assertThat(r.codesRejet()).containsExactly("E001");
  }

  @Test
  @DisplayName("Tarif conventionné : 10000 facturés plafonnés à 8000 avant le taux → 6400.00")
  void tarifConventionne() {
    UUID g = garantie("80", null, null, null);
    when(repo.tarifConvention(eq(ETAB), eq("CI-CONS"), eq(DATE))).thenReturn(new BigDecimal("8000.00"));
    assertThat(simuler(new Ligne(g, new BigDecimal("10000"), "CI-CONS")).get(0).montantCouvert())
        .isEqualByComparingTo("6400.00");
  }

  @Test
  @DisplayName("Trace du calcul (prisma/sql/074) : la ligne renvoie le tarif conventionné appliqué, null sans tarif")
  void tarifConventionneTrace() {
    UUID g = garantie("80", null, null, null);
    UUID tarif = UUID.fromString("00000000-0000-4000-8000-00000000c0de");
    when(repo.tarifConvention(eq(ETAB), eq("CI-CONS"), eq(DATE))).thenReturn(new BigDecimal("8000.00"));
    when(repo.tarifConventionneId(eq(ETAB), eq("CI-CONS"), eq(DATE))).thenReturn(tarif);
    List<ResultatLigne> r = simuler(
        new Ligne(g, new BigDecimal("10000"), "CI-CONS"), new Ligne(g, new BigDecimal("1000"), null));
    assertThat(r.get(0).tarifConventionneId()).isEqualTo(tarif);
    assertThat(r.get(1).tarifConventionneId()).isNull();
  }

  @Test
  @DisplayName("Garantie d'un autre produit que celui de la police → 400")
  void garantieAutreProduit() {
    UUID autre = UUID.randomUUID();
    when(repo.chargerGarantie(autre)).thenReturn(Optional.of(new GarantieApplicable(
        autre, UUID.randomUUID(), "CONSULTATION", new BigDecimal("80"), null, null, null, null, null, 0,
        "TOUT_RESEAU")));
    assertThatThrownBy(() -> simuler(new Ligne(autre, new BigDecimal("10000"), null)))
        .isInstanceOf(DemandeInvalide.class);
  }

  @Test
  @DisplayName("Titulaire et bénéficiaire ensemble → 400")
  void personneAmbigue() {
    UUID g = garantie("80", null, null, null);
    assertThatThrownBy(() -> service.simuler(new Demande(POLICE, ADHERENT, UUID.randomUUID(), ETAB, DATE,
        List.of(new Ligne(g, new BigDecimal("10000"), null)))))
        .isInstanceOf(DemandeInvalide.class);
  }

  // --- Plafond annuel double : par personne ET par famille (prisma/sql/069) ---

  @Test
  @DisplayName("Bénéficiaire : le plafond FAMILLE est celui de son titulaire — 25000 déjà pris par la famille sur 30000 → 5000.00")
  void beneficiaireCompteDansLaFamilleDuTitulaire() {
    UUID g = garantie("80", null, null, "30000", null);
    // cumul famille lu sur le TITULAIRE (sa consommation + celle de tous ses bénéficiaires)
    when(repo.sommeConsommeeFamille(ADHERENT, g, List.of(), PERIODE)).thenReturn(new BigDecimal("25000.00"));
    ResultatLigne r = service.simuler(new Demande(POLICE, null, BENEFICIAIRE, ETAB, DATE,
        List.of(new Ligne(g, new BigDecimal("10000"), null)))).get(0);
    assertThat(r.montantCouvert()).isEqualByComparingTo("5000.00");
    assertThat(r.plafondRestantApres()).isEqualByComparingTo("0.00");
    assertThat(r.codesRejet()).containsExactly("E006");
    verify(repo).sommeConsommeeFamille(ADHERENT, g, List.of(), PERIODE);
  }

  @Test
  @DisplayName("Facture : chaque ligne consomme AUSSI le plafond famille (15000) pour la suivante — 8000, 7000, 0")
  void plafondFamilleConsommeLigneParLigne() {
    UUID g = garantie("80", null, "50000", "15000", null);
    List<ResultatLigne> r = simuler(
        new Ligne(g, new BigDecimal("10000"), null),
        new Ligne(g, new BigDecimal("10000"), null),
        new Ligne(g, new BigDecimal("10000"), null));
    assertThat(r).extracting(ResultatLigne::montantCouvert)
        .usingComparatorForType(BigDecimal::compareTo, BigDecimal.class)
        .containsExactly(new BigDecimal("8000.00"), new BigDecimal("7000.00"), new BigDecimal("0.00"));
    assertThat(r.get(2).decision()).isEqualTo(Decision.REJETE);
  }

  @Test
  @DisplayName("Sans plafond famille : aucun cumul famille n'est lu")
  void sansPlafondFamillePasDeCumulFamille() {
    UUID g = garantie("80", null, "20000", null, null);
    simuler(new Ligne(g, new BigDecimal("10000"), null));
    org.mockito.Mockito.verify(repo, org.mockito.Mockito.never()).sommeConsommeeFamille(any(), any(), any(), any());
  }
}
