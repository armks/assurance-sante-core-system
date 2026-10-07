package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;

import ci.assurance.adjudication.domain.PeriodeCumul;
import java.time.LocalDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Période de cumul des plafonds annuels (prisma/sql/069) : bornes [debut, finExclue). */
class PeriodeCumulTest {

  private static void bornes(PeriodeCumul p, String debut, String finExclue) {
    assertThat(p.debut()).isEqualTo(LocalDate.parse(debut));
    assertThat(p.finExclue()).isEqualTo(LocalDate.parse(finExclue));
  }

  @Test
  @DisplayName("Année civile : 1er janvier – 31 décembre, quelle que soit la date de début de police")
  void anneeCivile() {
    bornes(
        PeriodeCumul.courante("ANNEE_CIVILE", LocalDate.of(2025, 3, 1), LocalDate.of(2026, 10, 7)),
        "2026-01-01", "2027-01-01");
  }

  @Test
  @DisplayName("Année de police : début 1er mars 2025, le 7 octobre 2026 → du 1er mars 2026 au 28 février 2027")
  void anneePolice() {
    bornes(
        PeriodeCumul.courante("ANNEE_POLICE", LocalDate.of(2025, 3, 1), LocalDate.of(2026, 10, 7)),
        "2026-03-01", "2027-03-01");
  }

  @Test
  @DisplayName("Année de police : la veille de l'anniversaire reste dans l'année précédente")
  void veilleAnniversaire() {
    bornes(
        PeriodeCumul.courante("ANNEE_POLICE", LocalDate.of(2025, 3, 1), LocalDate.of(2026, 2, 28)),
        "2025-03-01", "2026-03-01");
  }

  @Test
  @DisplayName("Année de police : le jour anniversaire ouvre une nouvelle période (compteurs à zéro)")
  void jourAnniversaire() {
    bornes(
        PeriodeCumul.courante("ANNEE_POLICE", LocalDate.of(2025, 3, 1), LocalDate.of(2026, 3, 1)),
        "2026-03-01", "2027-03-01");
  }

  @Test
  @DisplayName("Début au 29 février : chaque jour appartient à une et une seule période")
  void debutVingtNeufFevrier() {
    LocalDate debut = LocalDate.of(2024, 2, 29);
    // 2025 non bissextile : l'anniversaire tombe le 28 février
    bornes(PeriodeCumul.courante("ANNEE_POLICE", debut, LocalDate.of(2025, 2, 27)), "2024-02-29", "2025-02-28");
    bornes(PeriodeCumul.courante("ANNEE_POLICE", debut, LocalDate.of(2025, 2, 28)), "2025-02-28", "2026-02-28");
    // 2028 bissextile : retour au 29, sans dérive
    bornes(PeriodeCumul.courante("ANNEE_POLICE", debut, LocalDate.of(2028, 3, 1)), "2028-02-29", "2029-02-28");
  }

  @Test
  @DisplayName("Année de police sans date de début → année civile")
  void sansDateDebut() {
    PeriodeCumul p = PeriodeCumul.courante("ANNEE_POLICE", null, LocalDate.of(2026, 10, 7));
    assertThat(p.mode()).isEqualTo("ANNEE_CIVILE");
    bornes(p, "2026-01-01", "2027-01-01");
  }

  @Test
  @DisplayName("Avant le début de la police → première année de police")
  void avantDebut() {
    bornes(
        PeriodeCumul.courante("ANNEE_POLICE", LocalDate.of(2026, 11, 1), LocalDate.of(2026, 10, 7)),
        "2026-11-01", "2027-11-01");
  }
}
