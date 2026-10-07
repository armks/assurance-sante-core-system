package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;

import ci.assurance.adjudication.domain.Adjudicateur;
import ci.assurance.adjudication.domain.ContexteAdjudication;
import ci.assurance.adjudication.domain.Decision;
import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Plafond annuel double (prisma/sql/069) : par personne ET par famille, le plus restrictif
 * s'applique, un plafond absent est ignoré. Montants exacts.
 *
 * <p>Base commune (garantie de référence) : acte de 25 000, franchise 2 000, taux 80 %,
 * plafond par acte 50 000 → part couverte AVANT plafonds annuels = (25 000 − 2 000) × 80 %
 * = 18 400.
 */
class PlafondDoubleTest {

  private static final LocalDate DATE_SOIN = LocalDate.of(2026, 6, 15);
  private final Adjudicateur adjudicateur = new Adjudicateur();

  private static BigDecimal m(String v) {
    return v == null ? null : new BigDecimal(v);
  }

  private Adjudicateur.Resultat calculer(
      String plafondPersonne, String plafondFamille, String dejaPersonne, String dejaFamille) {
    ContexteAdjudication ctx =
        JeuDeDonneesReference.avecPlafonds(
            JeuDeDonneesReference.actif(new BigDecimal("25000.00")),
            m(plafondPersonne),
            m(plafondFamille));
    return adjudicateur.calculer(ctx, m(dejaPersonne), m(dejaFamille), DATE_SOIN);
  }

  @Test
  @DisplayName("Plafond PERSONNE seul : 30000, déjà 20000 → borné à 10000.00, REVUE_MANUELLE E006, restant 0.00")
  void personneSeul() {
    Adjudicateur.Resultat r = calculer("30000.00", null, "20000.00", "999999.00");
    assertThat(r.montantRembourse()).isEqualByComparingTo("10000.00");
    assertThat(r.decision()).isEqualTo(Decision.REVUE_MANUELLE);
    assertThat(r.codesRejet()).containsExactly("E006");
    assertThat(r.plafondRestantApres()).isEqualByComparingTo("0.00");
  }

  @Test
  @DisplayName("Plafond FAMILLE seul : 50000, famille déjà 40000 → borné à 10000.00, REVUE_MANUELLE E006")
  void familleSeul() {
    // le cumul personne (énorme) est ignoré : pas de plafond personne
    Adjudicateur.Resultat r = calculer(null, "50000.00", "999999.00", "40000.00");
    assertThat(r.montantRembourse()).isEqualByComparingTo("10000.00");
    assertThat(r.decision()).isEqualTo(Decision.REVUE_MANUELLE);
    assertThat(r.codesRejet()).containsExactly("E006");
    assertThat(r.plafondRestantApres()).isEqualByComparingTo("0.00");
  }

  @Test
  @DisplayName("Les deux, la FAMILLE mord avant : restant personne 90000, famille 8000 → 8000.00")
  void lesDeuxFamilleMordAvant() {
    Adjudicateur.Resultat r = calculer("100000.00", "60000.00", "10000.00", "52000.00");
    assertThat(r.montantRembourse()).isEqualByComparingTo("8000.00");
    assertThat(r.decision()).isEqualTo(Decision.REVUE_MANUELLE);
    assertThat(r.codesRejet()).containsExactly("E006");
    // restant le plus restrictif : famille 0 (personne : 90000 − 8000 = 82000)
    assertThat(r.plafondRestantApres()).isEqualByComparingTo("0.00");
  }

  @Test
  @DisplayName("Les deux, la PERSONNE mord avant : restant personne 5000, famille 150000 → 5000.00")
  void lesDeuxPersonneMordAvant() {
    Adjudicateur.Resultat r = calculer("30000.00", "200000.00", "25000.00", "50000.00");
    assertThat(r.montantRembourse()).isEqualByComparingTo("5000.00");
    assertThat(r.decision()).isEqualTo(Decision.REVUE_MANUELLE);
    assertThat(r.codesRejet()).containsExactly("E006");
    assertThat(r.plafondRestantApres()).isEqualByComparingTo("0.00");
  }

  @Test
  @DisplayName("Les deux, aucun ne mord : 18400.00 AUTO_ADJUDIQUE, restant = le plus petit (famille 31600.00)")
  void lesDeuxAucunNeMord() {
    Adjudicateur.Resultat r = calculer("100000.00", "200000.00", "0.00", "150000.00");
    assertThat(r.montantRembourse()).isEqualByComparingTo("18400.00");
    assertThat(r.decision()).isEqualTo(Decision.AUTO_ADJUDIQUE);
    assertThat(r.codesRejet()).isEmpty();
    // personne : 100000 − 18400 = 81600 ; famille : 200000 − 150000 − 18400 = 31600
    assertThat(r.plafondRestantApres()).isEqualByComparingTo("31600.00");
  }

  @Test
  @DisplayName("AUCUN plafond annuel : 18400.00 AUTO_ADJUDIQUE, aucun restant, cumuls ignorés")
  void aucunPlafond() {
    Adjudicateur.Resultat r = calculer(null, null, "999999.00", "999999.00");
    assertThat(r.montantRembourse()).isEqualByComparingTo("18400.00");
    assertThat(r.decision()).isEqualTo(Decision.AUTO_ADJUDIQUE);
    assertThat(r.plafondRestantApres()).isNull();
  }

  @Test
  @DisplayName("Famille ÉPUISÉE (60000 sur 60000) : REJETE E006, 0.00, même si la personne a de la marge")
  void familleEpuisee() {
    Adjudicateur.Resultat r = calculer("100000.00", "60000.00", "0.00", "60000.00");
    assertThat(r.montantRembourse()).isEqualByComparingTo("0.00");
    assertThat(r.decision()).isEqualTo(Decision.REJETE);
    assertThat(r.codesRejet()).containsExactly("E006");
  }

  @Test
  @DisplayName("Bénéficiaire : sa consommation et celle du titulaire comptent dans le même plafond famille")
  void beneficiaireDansLaFamilleDuTitulaire() {
    // famille 40000 : titulaire 30000 déjà + bénéficiaire 5000 déjà = 35000 → reste 5000
    ContexteAdjudication ctx =
        JeuDeDonneesReference.avecPlafonds(
            JeuDeDonneesReference.beneficiaireActif(new BigDecimal("25000.00")),
            m("100000.00"),
            m("40000.00"));
    Adjudicateur.Resultat r =
        adjudicateur.calculer(ctx, m("5000.00"), m("35000.00"), DATE_SOIN);
    assertThat(ctx.titulaireId()).isEqualTo(JeuDeDonneesReference.ADHERENT_ID);
    assertThat(r.montantRembourse()).isEqualByComparingTo("5000.00");
    assertThat(r.codesRejet()).containsExactly("E006");
  }
}
