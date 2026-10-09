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
import ci.assurance.adjudication.domain.PoliceApplicable;
import ci.assurance.adjudication.domain.SimulationService;
import ci.assurance.adjudication.domain.SimulationService.Demande;
import ci.assurance.adjudication.domain.SimulationService.Ligne;
import ci.assurance.adjudication.domain.SimulationService.ResultatLigne;
import ci.assurance.adjudication.web.dto.DecisionResponse;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Éligibilité et tarif appréciés à la DATE DES SOINS (ADR-006, amendement), et MÊMES règles
 * pour la réclamation (adjudication) et la facture tiers payant (simulation) : chaque cas
 * passe par les deux chemins et doit donner exactement la même décision, les mêmes codes et
 * le même montant.
 *
 * <p>Police : début 01/03/2025, garantie de référence (acte 25 000, franchise 2 000, taux
 * 80 % → 18 400). Police RÉSILIÉE au 28/02/2026, délai de déclaration 90 jours → déclaration
 * possible jusqu'au 29/05/2026 inclus.
 */
class EligibiliteDateSoinsTest {

  private static final LocalDate DEBUT = LocalDate.of(2025, 3, 1);
  private static final UUID ETAB = JeuDeDonneesReference.ETABLISSEMENT_ID;
  private static final UUID ORG = UUID.fromString("88888888-8888-4888-8888-888888888888");

  private static LocalDate date(String v) {
    return v == null || v.isBlank() ? null : LocalDate.parse(v.trim());
  }

  /** Réclamation déclarée le {@code declaration}, adjugée par le microservice. */
  private static DecisionResponse reclamation(
      String statut, LocalDate fin, int delai, LocalDate soins, LocalDate declaration, BigDecimal tarif) {
    ContexteAdjudication c = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));
    ContexteAdjudication ctx = new ContexteAdjudication(
        c.id(), c.organisationId(), c.dossierSoinsId(), c.acteDossierId(),
        c.adherentId(), c.beneficiaireId(), c.policeId(), c.garantieId(),
        c.montant(), c.typeReclamation(), c.statut(),
        declaration.atStartOfDay(ZoneOffset.UTC).toInstant(),
        c.tauxCouverturePct(), c.plafondParActe(), c.plafondAnnuelPersonne(), null, c.franchise(),
        c.ticketModerateurPct(), c.delaiCarenceJours(), c.reseauSoins(),
        statut, DEBUT, fin, ETAB, tarif,
        c.produitId(), c.titulaireId(), "ANNEE_CIVILE", soins, delai);
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    when(repo.chargerContexte(c.id())).thenReturn(Optional.of(ctx));
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(BigDecimal.ZERO);
    when(repo.insererRemboursement(any(), any(), any(), any(), anyLong())).thenReturn(UUID.randomUUID());
    when(repo.majStatut(eq(c.id()), any())).thenReturn(1);
    return new AdjudicationService(repo).evaluer(c.id());
  }

  /** Facture établie le {@code declaration} pour un acte réalisé le {@code soins}. */
  private static ResultatLigne facture(
      String statut, LocalDate fin, int delai, LocalDate soins, LocalDate declaration,
      AdjudicationRepository repo, String codeActe) {
    UUID police = UUID.randomUUID();
    UUID produit = UUID.randomUUID();
    UUID adherent = JeuDeDonneesReference.ADHERENT_ID;
    UUID g = UUID.randomUUID();
    when(repo.chargerPolice(police)).thenReturn(Optional.of(
        new PoliceApplicable(police, ORG, produit, statut, DEBUT, fin, "ANNEE_CIVILE", delai)));
    when(repo.chargerGarantie(g)).thenReturn(Optional.of(new GarantieApplicable(
        g, produit, "CONSULTATION", JeuDeDonneesReference.TAUX_PCT, JeuDeDonneesReference.PLAFOND_PAR_ACTE,
        JeuDeDonneesReference.PLAFOND_ANNUEL, null, JeuDeDonneesReference.FRANCHISE, null, 0, "TOUT_RESEAU")));
    when(repo.titulaireDe(adherent, null)).thenReturn(adherent);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(BigDecimal.ZERO);
    Clock jourDeLaFacture = Clock.fixed(declaration.atTime(12, 0).toInstant(ZoneOffset.UTC), ZoneOffset.UTC);
    return new SimulationService(repo, jourDeLaFacture).simuler(new Demande(
        police, adherent, null, ETAB, null,
        List.of(new Ligne(g, new BigDecimal("25000"), codeActe, null, soins)))).get(0);
  }

  @ParameterizedTest(name = "{0}")
  @CsvSource(delimiter = '|', value = {
      "Soins pendant la couverture, déclarés après la fin DANS le délai | RESILIEE | 2026-02-28 | 90 | 2026-02-10 | 2026-04-15 | AUTO_ADJUDIQUE | | 18400.00",
      "Soins pendant la couverture, déclarés le DERNIER jour du délai     | RESILIEE | 2026-02-28 | 90 | 2026-02-10 | 2026-05-29 | AUTO_ADJUDIQUE | | 18400.00",
      "Soins pendant la couverture, déclarés HORS délai (lendemain)      | RESILIEE | 2026-02-28 | 90 | 2026-02-10 | 2026-05-30 | REJETE | E014 | 0.00",
      "Délai 0 : déclaration le jour de la fin, acceptée                 | RESILIEE | 2026-02-28 | 0  | 2026-02-10 | 2026-02-28 | AUTO_ADJUDIQUE | | 18400.00",
      "Délai 0 : déclaration le lendemain de la fin, refusée             | RESILIEE | 2026-02-28 | 0  | 2026-02-10 | 2026-03-01 | REJETE | E014 | 0.00",
      "Soins AVANT le début de la police                                 | ACTIVE   |            | 90 | 2025-02-20 | 2025-03-10 | REJETE | E012 | 0.00",
      "Soins dans le FUTUR (après la date de déclaration)                | ACTIVE   |            | 90 | 2026-02-20 | 2026-02-15 | REJETE | E013 | 0.00",
      "Soins APRÈS la fin de la police                                   | RESILIEE | 2026-02-28 | 90 | 2026-03-05 | 2026-03-10 | REJETE | E001 | 0.00",
      "Police SUSPENDUE                                                  | SUSPENDUE |           | 90 | 2026-02-10 | 2026-02-12 | REJETE | E001 | 0.00",
      "Police active, soins et déclaration pendant la couverture         | ACTIVE   |            | 90 | 2026-02-10 | 2026-02-12 | AUTO_ADJUDIQUE | | 18400.00",
  })
  @DisplayName("Réclamation et facture : mêmes règles de date, mêmes résultats")
  void memesReglesReclamationEtFacture(
      String cas, String statut, String fin, int delai, String soins, String declaration,
      String decision, String code, String montant) {
    DecisionResponse r =
        reclamation(statut.trim(), date(fin), delai, date(soins), date(declaration), null);
    ResultatLigne f = facture(statut.trim(), date(fin), delai, date(soins), date(declaration),
        mock(AdjudicationRepository.class), null);

    List<String> codes = code == null || code.isBlank() ? List.of() : List.of(code.trim());
    assertThat(r.decision()).as("réclamation").isEqualTo(decision.trim());
    assertThat(r.codesRejet()).as("réclamation").isEqualTo(codes);
    assertThat(r.montantRembourse()).as("réclamation").isEqualByComparingTo(montant.trim());
    // la facture applique EXACTEMENT les mêmes règles
    assertThat(f.decision().name()).as("facture").isEqualTo(r.decision());
    assertThat(f.codesRejet()).as("facture").isEqualTo(r.codesRejet());
    assertThat(f.montantCouvert()).as("facture").isEqualByComparingTo(r.montantRembourse());
  }

  @Test
  @DisplayName("Tarif conventionné : celui en vigueur à la date des SOINS (15000 → 10400.00), pas celui du jour de la facture (22000)")
  void tarifEnVigueurALaDateDesSoins() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    LocalDate soins = LocalDate.of(2026, 1, 20);
    LocalDate facture = LocalDate.of(2026, 3, 10);
    when(repo.tarifConvention(ORG, ETAB, "CI-CONS", soins)).thenReturn(new BigDecimal("15000.00"));
    when(repo.tarifConvention(ORG, ETAB, "CI-CONS", facture)).thenReturn(new BigDecimal("22000.00"));

    ResultatLigne f = facture("ACTIVE", null, 90, soins, facture, repo, "CI-CONS");

    // (min(25000, 15000) − 2000) × 80 % = 10400 ; avec le tarif du jour : (22000 − 2000) × 80 % = 16000
    assertThat(f.montantCouvert()).isEqualByComparingTo("10400.00");
    verify(repo, never()).tarifConvention(ORG, ETAB, "CI-CONS", facture);

    // la réclamation reçoit le tarif de la date des soins (résolu en SQL, prisma/sql/070) :
    // à tarif égal, même montant que la facture
    DecisionResponse r = reclamation("ACTIVE", null, 90, soins, facture, new BigDecimal("15000.00"));
    assertThat(r.montantRembourse()).isEqualByComparingTo(f.montantCouvert());
  }
}
