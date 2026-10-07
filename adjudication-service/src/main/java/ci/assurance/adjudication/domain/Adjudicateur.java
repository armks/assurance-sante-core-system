package ci.assurance.adjudication.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Cœur financier : calcule la décision et le montant remboursé pour UNE
 * réclamation, à partir de son contexte et du cumul déjà remboursé dans l'année.
 *
 * <p>Fonction PURE — aucune I/O, aucune dépendance Spring — pour un test au
 * BigDecimal exact (zéro tolérance sur le calcul, règle qualité du plan directeur).
 *
 * <p>Règles (v3 §4, tarif conventionné v3 §5) :
 * <ol>
 *   <li>soin non couvert par la police À LA DATE DES SOINS ({@link EligibiliteSoins} :
 *       soins futurs E013, avant le début E012, après la fin ou police qui ne couvrait
 *       pas E001, déclaration hors délai après la fin E014) → REJETE, 0 ;</li>
 *   <li>tarif conventionné établissement × acte EN VIGUEUR À LA DATE DES SOINS, s'il
 *       existe : montant réclamé
 *       plafonné à min(montant_facture, tarif_convention) — AVANT tout autre
 *       calcul. Absence de tarif négocié (cas le plus courant) → montant
 *       facturé utilisé tel quel, comportement rétrocompatible ;</li>
 *   <li>franchise déduite du montant (éventuellement déjà plafonné) réclamé
 *       (plancher 0) ;</li>
 *   <li>taux de couverture appliqué ;</li>
 *   <li>plafond par acte : borne haute ;</li>
 *   <li>plafond annuel restant — le PLUS RESTRICTIF du restant par personne et du
 *       restant par famille (prisma/sql/069 ; un plafond absent est ignoré) : si
 *       épuisé → REJETE (E006), 0 ; sinon borne le remboursement — s'il le réduit,
 *       la réclamation part en REVUE_MANUELLE (E006) ;</li>
 *   <li>montant élevé (> seuil) → REVUE_MANUELLE (E010) ;</li>
 *   <li>sinon → AUTO_ADJUDIQUE.</li>
 * </ol>
 */
public class Adjudicateur {

  public static final int ECHELLE = 2;
  public static final RoundingMode ARRONDI = RoundingMode.HALF_UP;
  public static final BigDecimal CENT = new BigDecimal("100");
  public static final BigDecimal TAUX_DEFAUT_PCT = CENT;

  /** Au-dessus de ce montant remboursé, la réclamation passe en revue manuelle. */
  public static final BigDecimal SEUIL_REVUE_MANUELLE = new BigDecimal("150000.00");

  public record Resultat(
      Decision decision,
      BigDecimal montantRembourse,
      List<String> codesRejet,
      BigDecimal plafondRestantApres) {
  }

  /**
   * @param dateDeclaration date de la réclamation, ou jour de la facture / simulation ;
   *     la date des soins est {@code ctx.dateSoins()} (à défaut, la date de déclaration)
   * @param dejaPersonne déjà pris en charge sur la période pour la PERSONNE et la garantie
   * @param dejaFamille déjà pris en charge sur la période pour la FAMILLE (titulaire + ses
   *     bénéficiaires) et la garantie ; ignoré sans plafond famille
   */
  public Resultat calculer(
      ContexteAdjudication ctx,
      BigDecimal dejaPersonne,
      BigDecimal dejaFamille,
      LocalDate dateDeclaration) {

    final BigDecimal dejaP = normaliser(dejaPersonne, BigDecimal.ZERO);
    final BigDecimal dejaF = normaliser(dejaFamille, BigDecimal.ZERO);
    BigDecimal montantReclame = normaliser(ctx.montant(), BigDecimal.ZERO);
    // nullable = plafond absent, ignoré
    final BigDecimal plafondPersonne = ctx.plafondAnnuelPersonne();
    final BigDecimal plafondFamille = ctx.plafondAnnuelFamille();

    // 0) tarif conventionné établissement × acte (v3 §5) — plafonne le montant
    // facturé lui-même, avant tout le reste du calcul. `tarifConvention` est
    // nullable : aucun tarif négocié pour ce couple établissement/acte (le cas
    // le plus courant aujourd'hui) laisse `montantReclame` inchangé.
    if (ctx.tarifConvention() != null) {
      montantReclame = montantReclame.min(normaliser(ctx.tarifConvention(), montantReclame));
    }

    // restant le plus restrictif (null si aucun plafond annuel)
    final BigDecimal plafondRestantAvant =
        plusRestrictif(
            restant(plafondPersonne, dejaP, BigDecimal.ZERO),
            restant(plafondFamille, dejaF, BigDecimal.ZERO));

    // 1) éligibilité à la DATE DES SOINS — même règle pour la réclamation et la facture
    final LocalDate dateSoins = ctx.dateSoins() != null ? ctx.dateSoins() : dateDeclaration;
    final String motif =
        EligibiliteSoins.motifRejet(
            ctx.policeStatut(), ctx.policeDebut(), ctx.policeFin(),
            ctx.delaiDeclarationJours(), dateSoins, dateDeclaration);
    if (motif != null) {
      return new Resultat(Decision.REJETE, zero(), List.of(motif), plafondRestantAvant);
    }

    // 2) franchise
    final BigDecimal franchise = normaliser(ctx.franchise(), BigDecimal.ZERO);
    final BigDecimal apresFranchise = montantReclame.subtract(franchise).max(BigDecimal.ZERO);

    // 3) taux de couverture
    final BigDecimal tauxPct = normaliser(ctx.tauxCouverturePct(), TAUX_DEFAUT_PCT);
    BigDecimal couvert = apresFranchise.multiply(tauxPct).divide(CENT, ECHELLE, ARRONDI);

    // 4) plafond par acte
    if (ctx.plafondParActe() != null) {
      couvert = couvert.min(ctx.plafondParActe());
    }
    couvert = couvert.setScale(ECHELLE, ARRONDI);

    // 5) plafond annuel
    final BigDecimal montantRembourse;
    if (plafondRestantAvant != null) {
      if (plafondRestantAvant.signum() <= 0) {
        return new Resultat(
            Decision.REJETE, zero(), List.of(CodesRejet.PLAFOND_ATTEINT), zero());
      }
      montantRembourse = couvert.min(plafondRestantAvant).setScale(ECHELLE, ARRONDI);
    } else {
      montantRembourse = couvert;
    }

    final BigDecimal plafondRestantApres =
        plusRestrictif(
            restant(plafondPersonne, dejaP, montantRembourse),
            restant(plafondFamille, dejaF, montantRembourse));

    // 6) décision
    final List<String> codes = new ArrayList<>();
    final Decision decision;
    if (plafondRestantAvant != null && montantRembourse.compareTo(couvert) < 0) {
      codes.add(CodesRejet.PLAFOND_ATTEINT);
      decision = Decision.REVUE_MANUELLE;
    } else if (montantRembourse.compareTo(SEUIL_REVUE_MANUELLE) > 0) {
      codes.add(CodesRejet.MONTANT_ELEVE);
      decision = Decision.REVUE_MANUELLE;
    } else {
      decision = Decision.AUTO_ADJUDIQUE;
    }

    return new Resultat(decision, montantRembourse, List.copyOf(codes), plafondRestantApres);
  }

  /** Restant d'un plafond après {@code deja + montant} (plancher 0) ; null si pas de plafond. */
  private static BigDecimal restant(BigDecimal plafond, BigDecimal deja, BigDecimal montant) {
    return plafond == null
        ? null
        : plafond.subtract(deja).subtract(montant).max(BigDecimal.ZERO).setScale(ECHELLE, ARRONDI);
  }

  /** Le plus petit des restants définis ; null si aucun. */
  private static BigDecimal plusRestrictif(BigDecimal a, BigDecimal b) {
    if (a == null) {
      return b;
    }
    return b == null ? a : a.min(b);
  }

  private static BigDecimal normaliser(BigDecimal v, BigDecimal defaut) {
    return (v == null ? defaut : v).setScale(ECHELLE, ARRONDI);
  }

  private static BigDecimal zero() {
    return BigDecimal.ZERO.setScale(ECHELLE);
  }
}
