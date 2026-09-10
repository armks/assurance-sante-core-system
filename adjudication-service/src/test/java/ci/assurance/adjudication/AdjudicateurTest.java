package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;

import ci.assurance.adjudication.domain.Adjudicateur;
import ci.assurance.adjudication.domain.CodesRejet;
import ci.assurance.adjudication.domain.ContexteAdjudication;
import ci.assurance.adjudication.domain.Decision;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Tests du cœur financier — chaque cas vérifie un montant BigDecimal EXACT
 * (valeur ET échelle : {@code new BigDecimal("18400.00")} ≠ {@code "18400.0"}).
 */
class AdjudicateurTest {

  private final Adjudicateur adjudicateur = new Adjudicateur();
  private static final LocalDate DATE_SOIN = LocalDate.of(2026, 6, 15);

  @Test
  @DisplayName("Cas normal : franchise + taux 80 %, sous le plafond → AUTO_ADJUDIQUE, 18400.00")
  void casNormal() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));

    Adjudicateur.Resultat r = adjudicateur.calculer(ctx, new BigDecimal("0.00"), DATE_SOIN);

    // (25000 - 2000) * 80 % = 18400.00 ; min(18400, plafond acte 50000) ; plafond annuel 100000 non atteint
    assertEquals(Decision.AUTO_ADJUDIQUE, r.decision());
    assertEquals(new BigDecimal("18400.00"), r.montantRembourse());
    assertThat(r.codesRejet()).isEmpty();
    assertEquals(new BigDecimal("81600.00"), r.plafondRestantApres()); // 100000 - 0 - 18400
  }

  @Test
  @DisplayName("Cas plafond dépassé (partiel) : reste 5000 → REVUE_MANUELLE E006, 5000.00")
  void casPlafondDepassePartiel() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("30000.00"));

    // déjà 95 000 remboursés cette année → il ne reste que 5 000 de plafond
    Adjudicateur.Resultat r = adjudicateur.calculer(ctx, new BigDecimal("95000.00"), DATE_SOIN);

    // couvert = (30000 - 2000) * 80 % = 22400.00, mais plafond restant = 5000.00
    assertEquals(Decision.REVUE_MANUELLE, r.decision());
    assertEquals(new BigDecimal("5000.00"), r.montantRembourse());
    assertEquals(List.of(CodesRejet.PLAFOND_ATTEINT), r.codesRejet());
    assertEquals(new BigDecimal("0.00"), r.plafondRestantApres());
  }

  @Test
  @DisplayName("Cas plafond épuisé : plus rien de disponible → REJETE E006, 0.00")
  void casPlafondEpuise() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("30000.00"));

    Adjudicateur.Resultat r = adjudicateur.calculer(ctx, new BigDecimal("100000.00"), DATE_SOIN);

    assertEquals(Decision.REJETE, r.decision());
    assertEquals(new BigDecimal("0.00"), r.montantRembourse());
    assertEquals(List.of(CodesRejet.PLAFOND_ATTEINT), r.codesRejet());
    assertEquals(new BigDecimal("0.00"), r.plafondRestantApres());
  }

  @Test
  @DisplayName("Cas police inactive : SUSPENDUE → REJETE E001, 0.00, plafond intact")
  void casPoliceInactive() {
    ContexteAdjudication ctx =
        JeuDeDonneesReference.contexte(new BigDecimal("25000.00"), "SUSPENDUE");

    Adjudicateur.Resultat r = adjudicateur.calculer(ctx, new BigDecimal("0.00"), DATE_SOIN);

    assertEquals(Decision.REJETE, r.decision());
    assertEquals(new BigDecimal("0.00"), r.montantRembourse());
    assertEquals(List.of(CodesRejet.POLICE_INACTIVE), r.codesRejet());
    assertEquals(new BigDecimal("100000.00"), r.plafondRestantApres()); // rien consommé
  }

  @Test
  @DisplayName("Cas police hors période : soin après date_fin → REJETE E001")
  void casPoliceHorsPeriode() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));

    Adjudicateur.Resultat r =
        adjudicateur.calculer(ctx, new BigDecimal("0.00"), LocalDate.of(2027, 1, 5));

    assertEquals(Decision.REJETE, r.decision());
    assertEquals(new BigDecimal("0.00"), r.montantRembourse());
    assertEquals(List.of(CodesRejet.POLICE_INACTIVE), r.codesRejet());
  }

  @Test
  @DisplayName("Cas montant élevé : > seuil 150000 → REVUE_MANUELLE E010")
  void casMontantEleve() {
    // garantie sans franchise ni plafond par acte, taux 100 %, plafond annuel très large
    ContexteAdjudication base = JeuDeDonneesReference.actif(new BigDecimal("300000.00"));
    ContexteAdjudication ctx =
        new ContexteAdjudication(
            base.id(), base.organisationId(), base.dossierSoinsId(), base.acteDossierId(),
            base.adherentId(), base.beneficiaireId(), base.policeId(), base.garantieId(),
            base.montant(), base.typeReclamation(), base.statut(), base.createdAt(),
            new BigDecimal("100"), // taux 100 %
            null,                  // pas de plafond par acte
            new BigDecimal("5000000.00"), // plafond annuel large
            new BigDecimal("0.00"),       // pas de franchise
            base.ticketModerateurPct(), base.delaiCarenceJours(), base.reseauSoins(),
            base.policeStatut(), base.policeDebut(), base.policeFin());

    Adjudicateur.Resultat r = adjudicateur.calculer(ctx, new BigDecimal("0.00"), DATE_SOIN);

    assertEquals(Decision.REVUE_MANUELLE, r.decision());
    assertEquals(new BigDecimal("300000.00"), r.montantRembourse());
    assertEquals(List.of(CodesRejet.MONTANT_ELEVE), r.codesRejet());
    assertEquals(new BigDecimal("4700000.00"), r.plafondRestantApres());
  }
}
