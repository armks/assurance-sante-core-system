package ci.assurance.adjudication;

import ci.assurance.adjudication.domain.ContexteAdjudication;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Jeu de données de référence pour les tests d'adjudication (montants EXACTS).
 *
 * <p>Garantie de référence :
 * <ul>
 *   <li>taux de couverture : 80 %</li>
 *   <li>franchise : 2 000</li>
 *   <li>plafond par acte : 50 000</li>
 *   <li>plafond annuel par personne : 100 000 ; pas de plafond famille</li>
 *   <li>délai de carence : 0 j</li>
 * </ul>
 * Police ACTIVE du 2026-01-01 au 2026-12-31, produit en année civile. Réclamation créée
 * le 2026-06-15.
 */
public final class JeuDeDonneesReference {

  private JeuDeDonneesReference() {}

  public static final UUID RECLAMATION_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
  public static final UUID ADHERENT_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
  public static final UUID POLICE_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
  public static final UUID GARANTIE_ID = UUID.fromString("44444444-4444-4444-8444-444444444444");
  public static final UUID ETABLISSEMENT_ID = UUID.fromString("55555555-5555-4555-8555-555555555555");
  public static final UUID PRODUIT_ID = UUID.fromString("77777777-7777-4777-8777-777777777777");

  public static final BigDecimal TAUX_PCT = new BigDecimal("80");
  public static final BigDecimal FRANCHISE = new BigDecimal("2000.00");
  public static final BigDecimal PLAFOND_PAR_ACTE = new BigDecimal("50000.00");
  public static final BigDecimal PLAFOND_ANNUEL = new BigDecimal("100000.00");
  public static final Instant DATE_CREATION = LocalDate.of(2026, 6, 15).atStartOfDay(java.time.ZoneOffset.UTC).toInstant();

  /** Contexte de base, personnalisable par les {@code with*} ci-dessous. */
  public static ContexteAdjudication contexte(
      BigDecimal montantReclame, String policeStatut) {
    return contexte(montantReclame, policeStatut, null);
  }

  /** Variante avec tarif conventionné établissement × acte (v3 §5), ou {@code null}. */
  public static ContexteAdjudication contexte(
      BigDecimal montantReclame, String policeStatut, BigDecimal tarifConvention) {
    return new ContexteAdjudication(
        RECLAMATION_ID,
        UUID.fromString("00000000-0000-4000-8000-0000000000aa"), // organisation
        UUID.fromString("00000000-0000-4000-8000-0000000000dd"), // dossier
        UUID.fromString("00000000-0000-4000-8000-0000000000ee"), // acte
        ADHERENT_ID,
        null, // bénéficiaire
        POLICE_ID,
        GARANTIE_ID,
        montantReclame,
        "SOIN",
        "EN_ADJUDICATION",
        DATE_CREATION,
        TAUX_PCT,
        PLAFOND_PAR_ACTE,
        PLAFOND_ANNUEL,
        null, // pas de plafond famille
        FRANCHISE,
        new BigDecimal("20"), // ticket modérateur (non utilisé par le calcul actuel)
        0, // carence
        "TOUT_RESEAU",
        policeStatut,
        LocalDate.of(2026, 1, 1),
        LocalDate.of(2026, 12, 31),
        ETABLISSEMENT_ID,
        tarifConvention,
        PRODUIT_ID,
        ADHERENT_ID, // titulaire de la famille
        "ANNEE_CIVILE");
  }

  public static ContexteAdjudication actif(BigDecimal montantReclame) {
    return contexte(montantReclame, "ACTIVE", null);
  }

  /** Police ACTIVE avec un tarif conventionné applicable à l'acte réclamé. */
  public static ContexteAdjudication actifAvecTarifConventionne(
      BigDecimal montantReclame, BigDecimal tarifConvention) {
    return contexte(montantReclame, "ACTIVE", tarifConvention);
  }

  public static final UUID BENEFICIAIRE_ID = UUID.fromString("66666666-6666-4666-8666-666666666666");

  /**
   * Réclamation d'un BÉNÉFICIAIRE (enfant, conjoint…) : {@code adherent_id} est
   * NULL, seul {@code beneficiaire_id} est renseigné (exclusivité en base).
   */
  public static ContexteAdjudication beneficiaireActif(BigDecimal montantReclame) {
    ContexteAdjudication c = actif(montantReclame);
    return new ContexteAdjudication(
        c.id(), c.organisationId(), c.dossierSoinsId(), c.acteDossierId(),
        null, BENEFICIAIRE_ID, c.policeId(), c.garantieId(),
        c.montant(), c.typeReclamation(), c.statut(), c.createdAt(),
        c.tauxCouverturePct(), c.plafondParActe(),
        c.plafondAnnuelPersonne(), c.plafondAnnuelFamille(), c.franchise(),
        c.ticketModerateurPct(), c.delaiCarenceJours(), c.reseauSoins(),
        c.policeStatut(), c.policeDebut(), c.policeFin(),
        c.etablissementId(), c.tarifConvention(),
        c.produitId(), ADHERENT_ID /* titulaire du bénéficiaire */, c.periodeCumul());
  }

  /** Copie de {@code c} avec ses deux plafonds annuels (chacun nullable = absent). */
  public static ContexteAdjudication avecPlafonds(
      ContexteAdjudication c, BigDecimal personne, BigDecimal famille) {
    return new ContexteAdjudication(
        c.id(), c.organisationId(), c.dossierSoinsId(), c.acteDossierId(),
        c.adherentId(), c.beneficiaireId(), c.policeId(), c.garantieId(),
        c.montant(), c.typeReclamation(), c.statut(), c.createdAt(),
        c.tauxCouverturePct(), c.plafondParActe(), personne, famille, c.franchise(),
        c.ticketModerateurPct(), c.delaiCarenceJours(), c.reseauSoins(),
        c.policeStatut(), c.policeDebut(), c.policeFin(),
        c.etablissementId(), c.tarifConvention(),
        c.produitId(), c.titulaireId(), c.periodeCumul());
  }
}
