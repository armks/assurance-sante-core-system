package ci.assurance.adjudication.domain;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * Période sur laquelle les plafonds annuels se cumulent ({@code produits.periode_cumul_plafond},
 * prisma/sql/069) : bornes {@code [debut, finExclue)}.
 *
 * <ul>
 *   <li>{@code ANNEE_CIVILE} : 1er janvier – 31 décembre de l'année de {@code jour} (comportement
 *       historique, codé en dur avant 069) ;</li>
 *   <li>{@code ANNEE_POLICE} : année d'anniversaire de la date de début de la police contenant
 *       {@code jour} (ex. début 1er mars 2025 → du 1er mars au 28/29 février suivant). Police sans
 *       date de début → année civile ; {@code jour} antérieur au début → première année de police.</li>
 * </ul>
 *
 * <p>Fonction PURE (aucune I/O). Les anniversaires sont toujours calculés depuis la date
 * d'origine ({@code debutPolice.plusYears(k)}) : un début au 29 février tombe le 28 les années
 * non bissextiles, sans dérive d'une année sur l'autre.
 */
public record PeriodeCumul(String mode, LocalDate debut, LocalDate finExclue) {

  public static final String ANNEE_CIVILE = "ANNEE_CIVILE";
  public static final String ANNEE_POLICE = "ANNEE_POLICE";

  public static PeriodeCumul courante(String mode, LocalDate debutPolice, LocalDate jour) {
    if (ANNEE_POLICE.equals(mode) && debutPolice != null) {
      if (jour.isBefore(debutPolice)) {
        return new PeriodeCumul(ANNEE_POLICE, debutPolice, debutPolice.plusYears(1));
      }
      // invariant : debutPolice + k ans <= jour < debutPolice + (k + 1) ans
      long k = ChronoUnit.YEARS.between(debutPolice, jour);
      while (k > 0 && debutPolice.plusYears(k).isAfter(jour)) {
        k--;
      }
      while (!debutPolice.plusYears(k + 1).isAfter(jour)) {
        k++;
      }
      return new PeriodeCumul(ANNEE_POLICE, debutPolice.plusYears(k), debutPolice.plusYears(k + 1));
    }
    final LocalDate debut = jour.withDayOfYear(1);
    return new PeriodeCumul(ANNEE_CIVILE, debut, debut.plusYears(1));
  }
}
