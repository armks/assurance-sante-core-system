package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ci.assurance.adjudication.domain.AdjudicationRepository;
import ci.assurance.adjudication.domain.AdjudicationRepository.CotationActe;
import ci.assurance.adjudication.domain.AdjudicationRepository.LigneConvention;
import ci.assurance.adjudication.domain.AdjudicationService;
import ci.assurance.adjudication.domain.ContexteAdjudication;
import ci.assurance.adjudication.domain.ContexteTarif;
import ci.assurance.adjudication.domain.ConventionApplicable;
import ci.assurance.adjudication.domain.GarantieApplicable;
import ci.assurance.adjudication.domain.PoliceApplicable;
import ci.assurance.adjudication.domain.ResolveurTarif;
import ci.assurance.adjudication.domain.SimulationService;
import ci.assurance.adjudication.domain.SimulationService.Demande;
import ci.assurance.adjudication.domain.SimulationService.Ligne;
import ci.assurance.adjudication.domain.SimulationService.ResultatLigne;
import ci.assurance.adjudication.domain.TarifResolu;
import ci.assurance.adjudication.web.dto.DecisionResponse;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
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
 * Résolveur de tarif centralisé (ADR-008, lot 3) — cas chiffrés. DONNÉES FICTIVES : codes d'actes, lettres-clés et
 * valeurs inventés pour les tests.
 *
 * <p>Garantie de référence ({@link JeuDeDonneesReference}) : taux 80 %, franchise 2 000, plafond par acte 50 000.
 * Part assurance = arrondi_unité( (min(prix affiché, tarif reconnu) − 2 000) × 80 % ) ; part patient = prix − part assurance.
 */
class ResolveurTarifTest {

  private static final UUID ORG = UUID.fromString("00000000-0000-4000-8000-0000000000aa");
  private static final UUID AUTRE_ORG = UUID.fromString("99999999-9999-4999-8999-999999999999");
  private static final UUID ETAB = JeuDeDonneesReference.ETABLISSEMENT_ID;
  private static final LocalDate SOINS = JeuDeDonneesReference.DATE_SOINS; // 2026-06-15
  private static final String CODE = "FICT-ACTE-1";

  private AdjudicationRepository repo;
  private UUID acte;
  private UUID conv;

  @BeforeEach
  void init() {
    repo = mock(AdjudicationRepository.class);
    acte = UUID.randomUUID();
    conv = UUID.randomUUID();
    when(repo.referentielActeId(ORG, CODE)).thenReturn(Optional.of(acte));
  }

  private ConventionApplicable convention(String politique, boolean historique) {
    ConventionApplicable c = new ConventionApplicable(
        conv, "CONV-FICTIVE", 1, politique, historique, LocalDate.of(2026, 1, 1), null);
    when(repo.conventionEnVigueur(ORG, ETAB, SOINS)).thenReturn(Optional.of(c));
    return c;
  }

  private UUID forfait(String montant) {
    UUID ligne = UUID.randomUUID();
    when(repo.ligneConvention(conv, acte, SOINS))
        .thenReturn(Optional.of(new LigneConvention(ligne, new BigDecimal(montant), null)));
    return ligne;
  }

  private void valeurPropre(String valeur) {
    when(repo.ligneConvention(conv, acte, SOINS))
        .thenReturn(Optional.of(new LigneConvention(UUID.randomUUID(), null, new BigDecimal(valeur))));
  }

  private void cotation(String lettre, String coef) {
    when(repo.cotationActe(ORG, acte)).thenReturn(Optional.of(new CotationActe(lettre, new BigDecimal(coef))));
  }

  private void valeurLettre(String lettre, String contexte, String valeur) {
    when(repo.valeurLettreCle(conv, lettre, contexte)).thenReturn(Optional.of(new BigDecimal(valeur)));
  }

  private TarifResolu resoudre(String typeVisite) {
    return new ResolveurTarif(repo).resoudre(new ContexteTarif(ORG, ETAB, null, CODE, SOINS, typeVisite));
  }

  // ----------------------------------------------------------------------------------------------
  // une règle d'origine par cas

  @Test
  @DisplayName("FORFAIT : le forfait de l'acte dans la convention, ligne de forfait tracée")
  void forfaitDeLActe() {
    convention("PATIENT", false);
    UUID ligne = forfait("3000.00");
    cotation("B", "2.5"); // la cotation existe mais le forfait passe AVANT
    valeurLettre("B", "AMBULATOIRE", "1000.00");

    TarifResolu t = resoudre(null);

    assertThat(t.regle()).isEqualTo(TarifResolu.Regle.FORFAIT);
    assertThat(t.tarifReconnu()).isEqualByComparingTo("3000");
    assertThat(t.tarifConventionneId()).isEqualTo(ligne);
    assertThat(t.conventionId()).isEqualTo(conv);
    assertThat(t.lettreCle()).isNull();
  }

  @Test
  @DisplayName("VALEUR_PROPRE : coefficient 2,5 × valeur propre à l'acte 1 400 = 3 500 (avant la valeur de la convention)")
  void valeurPropreALActe() {
    convention("PATIENT", false);
    valeurPropre("1400.00");
    cotation("B", "2.5");
    valeurLettre("B", "AMBULATOIRE", "1000.00");

    TarifResolu t = resoudre(null);

    assertThat(t.regle()).isEqualTo(TarifResolu.Regle.VALEUR_PROPRE);
    assertThat(t.tarifReconnu()).isEqualByComparingTo("3500");
    assertThat(t.lettreCle()).isEqualTo("B");
    assertThat(t.coefficient()).isEqualByComparingTo("2.5");
    assertThat(t.valeurAppliquee()).isEqualByComparingTo("1400");
    assertThat(t.tarifConventionneId()).isNull();
  }

  @Test
  @DisplayName("VALEUR_LETTRE_CLE : coefficient 2,5 × valeur ambulatoire 1 000 = 2 500")
  void valeurDeLettreCle() {
    convention("PATIENT", false);
    cotation("B", "2.5");
    valeurLettre("B", "AMBULATOIRE", "1000.00");
    valeurLettre("B", "HOSPITALISATION", "1500.00");

    TarifResolu t = resoudre(null);

    assertThat(t.regle()).isEqualTo(TarifResolu.Regle.VALEUR_LETTRE_CLE);
    assertThat(t.tarifReconnu()).isEqualByComparingTo("2500");
    assertThat(t.valeurAppliquee()).isEqualByComparingTo("1000");
  }

  @Test
  @DisplayName("AUCUNE_CONVENTION : sans convention en vigueur, comportement historique (prix affiché reconnu)")
  void aucuneConvention() {
    when(repo.conventionEnVigueur(ORG, ETAB, SOINS)).thenReturn(Optional.empty());

    TarifResolu t = resoudre(null);

    assertThat(t.regle()).isEqualTo(TarifResolu.Regle.AUCUNE_CONVENTION);
    assertThat(t.conventionne()).isFalse();
    assertThat(t.nonTarifable()).isFalse();
  }

  @Test
  @DisplayName("Convention HISTORIQUE (migration) : un acte qu'elle ne liste pas garde le comportement historique")
  void conventionHistoriqueActeNonListe() {
    convention("PATIENT", true);
    when(repo.ligneConvention(conv, acte, SOINS)).thenReturn(Optional.empty());

    assertThat(resoudre(null).regle()).isEqualTo(TarifResolu.Regle.AUCUNE_CONVENTION);
  }

  // ----------------------------------------------------------------------------------------------
  // contexte, non tarifable

  @Test
  @DisplayName("Contexte : HOSPITALISATION_MEDICALE → valeur hospitalisation (1 500) ; consultation ou type absent → ambulatoire (1 000)")
  void contexteHospitalisation() {
    convention("PATIENT", false);
    cotation("B", "2.5");
    valeurLettre("B", "AMBULATOIRE", "1000.00");
    valeurLettre("B", "HOSPITALISATION", "1500.00");

    assertThat(resoudre("HOSPITALISATION_MEDICALE").tarifReconnu()).isEqualByComparingTo("3750");
    assertThat(resoudre("CONSULTATION_GENERALISTE").tarifReconnu()).isEqualByComparingTo("2500");
    assertThat(resoudre(null).tarifReconnu()).isEqualByComparingTo("2500");
  }

  @Test
  @DisplayName("Non tarifable : valeur de la lettre-clé absente dans CE contexte, ni forfait → statut explicite, message clair, aucun prix")
  void nonTarifableContexteSansValeur() {
    convention("PATIENT", false);
    cotation("B", "2.5");
    valeurLettre("B", "AMBULATOIRE", "1000.00"); // pas de valeur hospitalisation

    TarifResolu t = resoudre("HOSPITALISATION_MEDICALE");

    assertThat(t.nonTarifable()).isTrue();
    assertThat(t.tarifReconnu()).isNull();
    assertThat(t.message()).contains("lettre-clé B").contains("hospitalisation").contains("CONV-FICTIVE");
  }

  @Test
  @DisplayName("Non tarifable : acte non coté et sans forfait ; acte absent du référentiel de l'organisation")
  void nonTarifableActeNonCote() {
    convention("PATIENT", false);
    when(repo.ligneConvention(conv, acte, SOINS)).thenReturn(Optional.empty());
    when(repo.cotationActe(ORG, acte)).thenReturn(Optional.empty());
    assertThat(resoudre(null).nonTarifable()).isTrue();

    when(repo.referentielActeId(ORG, CODE)).thenReturn(Optional.empty());
    TarifResolu inconnu = resoudre(null);
    assertThat(inconnu.nonTarifable()).isTrue();
    assertThat(inconnu.message()).contains("référentiel");
  }

  // ----------------------------------------------------------------------------------------------
  // convention fermée puis nouvelle version : aucun trou

  @Test
  @DisplayName("Convention fermée par nouvelle version : v1 jusqu'au 31/05 (forfait 3 000), v2 dès le 01/06 (forfait 4 000) — aucun jour sans convention")
  void conventionFermeePuisNouvelle() {
    UUID conv1 = UUID.randomUUID();
    UUID conv2 = UUID.randomUUID();
    LocalDate dernierJourV1 = LocalDate.of(2026, 5, 31);
    LocalDate premierJourV2 = LocalDate.of(2026, 6, 1);
    ConventionApplicable v1 = new ConventionApplicable(conv1, "C", 1, "PATIENT", false, LocalDate.of(2026, 1, 1), dernierJourV1);
    ConventionApplicable v2 = new ConventionApplicable(conv2, "C", 2, "PATIENT", false, premierJourV2, null);
    when(repo.conventionEnVigueur(ORG, ETAB, dernierJourV1)).thenReturn(Optional.of(v1));
    when(repo.conventionEnVigueur(ORG, ETAB, premierJourV2)).thenReturn(Optional.of(v2));
    when(repo.ligneConvention(conv1, acte, dernierJourV1))
        .thenReturn(Optional.of(new LigneConvention(UUID.randomUUID(), new BigDecimal("3000"), null)));
    when(repo.ligneConvention(conv2, acte, premierJourV2))
        .thenReturn(Optional.of(new LigneConvention(UUID.randomUUID(), new BigDecimal("4000"), null)));

    ResolveurTarif r = new ResolveurTarif(repo);
    TarifResolu avant = r.resoudre(new ContexteTarif(ORG, ETAB, null, CODE, dernierJourV1, null));
    TarifResolu apres = r.resoudre(new ContexteTarif(ORG, ETAB, null, CODE, premierJourV2, null));

    assertThat(avant.tarifReconnu()).isEqualByComparingTo("3000");
    assertThat(avant.conventionId()).isEqualTo(conv1);
    assertThat(apres.tarifReconnu()).isEqualByComparingTo("4000");
    assertThat(apres.conventionId()).isEqualTo(conv2);
  }

  @Test
  @DisplayName("Deux organisations, MÊME code d'acte : chacune résout SON acte et SA convention, jamais celles de l'autre")
  void deuxOrganisationsMemeCode() {
    // organisation A : forfait 3 000 ; organisation B : forfait 9 000, même code d'acte, même établissement (fictif)
    convention("PATIENT", false);
    forfait("3000");
    UUID acteB = UUID.randomUUID();
    UUID convB = UUID.randomUUID();
    when(repo.referentielActeId(AUTRE_ORG, CODE)).thenReturn(Optional.of(acteB));
    when(repo.conventionEnVigueur(AUTRE_ORG, ETAB, SOINS)).thenReturn(Optional.of(
        new ConventionApplicable(convB, "CONV-B", 1, "PATIENT", false, LocalDate.of(2026, 1, 1), null)));
    when(repo.ligneConvention(convB, acteB, SOINS))
        .thenReturn(Optional.of(new LigneConvention(UUID.randomUUID(), new BigDecimal("9000"), null)));

    ResolveurTarif r = new ResolveurTarif(repo);
    assertThat(r.resoudre(new ContexteTarif(ORG, ETAB, null, CODE, SOINS, null)).tarifReconnu()).isEqualByComparingTo("3000");
    assertThat(r.resoudre(new ContexteTarif(AUTRE_ORG, ETAB, null, CODE, SOINS, null)).tarifReconnu()).isEqualByComparingTo("9000");
    // A ne reçoit jamais l'acte / la convention de B
    org.mockito.Mockito.verify(repo, org.mockito.Mockito.never()).ligneConvention(conv, acteB, SOINS);
  }

  // ----------------------------------------------------------------------------------------------
  // arrondi HALF_UP à l'unité

  @ParameterizedTest(name = "coef {0} × valeur {1} = {2} → reconnu {3} ; part assurance {4} ; part patient (prix 5000) {5}")
  @CsvSource({
      // brut 2582,5 → 2583 ; (2583 − 2000) × 80 % = 466,4 → 466 ; patient 5000 − 466
      "2.5, 1033.00, 2582.5, 2583, 466, 4534",
      // brut 1501,5 → 1502 ; sous la franchise → 0
      "1.5, 1001.00, 1501.5, 1502, 0, 5000",
      // brut 2002 ; (2002 − 2000) × 80 % = 1,6 → 2 (et non 1) ; patient 4998
      "2,   1001.00, 2002, 2002, 2, 4998",
      // brut 2500,25 → 2500 ; 500 × 80 % = 400
      "1.0001, 2500.00, 2500.25, 2500, 400, 4600",
      // brut 3333,3333 (coef 3,3333 × 1000) → 3333 ; 1333 × 80 % = 1066,4 → 1066
      "3.3333, 1000.00, 3333.3, 3333, 1066, 3934",
  })
  void arrondiHalfUp(String coef, String valeur, String brut, String reconnu, String partAssurance, String partPatient) {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    convention("PATIENT", false);
    cotation("B", coef);
    valeurLettre("B", "AMBULATOIRE", valeur);

    ResultatLigne r = simuler(repoPourSimulation(police, g, ORG), police, g, "5000", null);

    assertThat(r.trace().tarifReconnu()).isEqualByComparingTo(reconnu);
    assertThat(r.montantCouvert()).isEqualByComparingTo(partAssurance);
    assertThat(new BigDecimal("5000").subtract(r.montantCouvert())).isEqualByComparingTo(partPatient);
    assertThat(r.montantCouvert().scale()).isEqualTo(2);
  }

  // ----------------------------------------------------------------------------------------------
  // politique de dépassement + trace de la ligne

  @Test
  @DisplayName("Dépassement PATIENT : prix 5 000, forfait 3 000 → assurance (3 000 − 2 000) × 80 % = 800 ; patient 4 200 ; trace : écart 2 000")
  void depassementPatient() {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    convention("PATIENT", false);
    UUID ligne = forfait("3000.00");

    ResultatLigne r = simuler(repoPourSimulation(police, g, ORG), police, g, "5000", null);

    assertThat(r.decision().name()).isEqualTo("AUTO_ADJUDIQUE");
    assertThat(r.montantCouvert()).isEqualByComparingTo("800");
    assertThat(new BigDecimal("5000").subtract(r.montantCouvert())).isEqualByComparingTo("4200");
    assertThat(r.tarifConventionneId()).isEqualTo(ligne);
    assertThat(r.trace().regleOrigine()).isEqualTo("FORFAIT");
    assertThat(r.trace().statutTarif()).isEqualTo("TARIFABLE");
    assertThat(r.trace().prixAffiche()).isEqualByComparingTo("5000");
    assertThat(r.trace().tarifReconnu()).isEqualByComparingTo("3000");
    assertThat(r.trace().ecart()).isEqualByComparingTo("2000");
    assertThat(r.trace().conventionId()).isEqualTo(conv);
    assertThat(r.trace().politiqueDepassement()).isEqualTo("PATIENT");
  }

  @Test
  @DisplayName("Dépassement REJET : prix 5 000 > forfait 3 000 → acte rejeté E015, 0 payé ; prix 3 000 (= tarif) → accepté, 800")
  void depassementRejet() {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    convention("REJET", false);
    forfait("3000.00");
    AdjudicationRepository r0 = repoPourSimulation(police, g, ORG);

    ResultatLigne rejete = simuler(r0, police, g, "5000", null);
    assertThat(rejete.decision().name()).isEqualTo("REJETE");
    assertThat(rejete.codesRejet()).containsExactly("E015");
    assertThat(rejete.montantCouvert()).isEqualByComparingTo("0");
    assertThat(rejete.trace().ecart()).isEqualByComparingTo("2000");

    ResultatLigne accepte = simuler(r0, police, g, "3000", null);
    assertThat(accepte.decision().name()).isEqualTo("AUTO_ADJUDIQUE");
    assertThat(accepte.montantCouvert()).isEqualByComparingTo("800");
    assertThat(accepte.trace().ecart()).isEqualByComparingTo("0");
  }

  @Test
  @DisplayName("Prix affiché inférieur au tarif reconnu : le prix affiché est retenu (écart négatif en trace), même sous REJET")
  void prixInferieurAuTarif() {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    convention("REJET", false);
    forfait("3000.00");

    ResultatLigne r = simuler(repoPourSimulation(police, g, ORG), police, g, "2500", null);

    assertThat(r.decision().name()).isEqualTo("AUTO_ADJUDIQUE");
    assertThat(r.montantCouvert()).isEqualByComparingTo("400"); // (2500 − 2000) × 80 %
    assertThat(r.trace().ecart()).isEqualByComparingTo("-500");
  }

  @Test
  @DisplayName("Non tarifable : décision REJETE E016, 0 payé, trace NON_TARIFABLE avec message, jamais de prix par défaut")
  void nonTarifableRejeteSansPrixParDefaut() {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    convention("PATIENT", false);
    cotation("B", "2.5"); // aucune valeur de lettre-clé B

    ResultatLigne r = simuler(repoPourSimulation(police, g, ORG), police, g, "5000", null);

    assertThat(r.decision().name()).isEqualTo("REJETE");
    assertThat(r.codesRejet()).containsExactly("E016");
    assertThat(r.montantCouvert()).isEqualByComparingTo("0");
    assertThat(r.trace().statutTarif()).isEqualTo("NON_TARIFABLE");
    assertThat(r.trace().tarifReconnu()).isNull();
    assertThat(r.trace().message()).contains("lettre-clé B");
  }

  @Test
  @DisplayName("Sans convention : prix affiché reconnu, écart 0, règle AUCUNE_CONVENTION tracée (5 000 → (5 000 − 2 000) × 80 % = 2 400)")
  void traceSansConvention() {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    when(repo.conventionEnVigueur(ORG, ETAB, SOINS)).thenReturn(Optional.empty());

    ResultatLigne r = simuler(repoPourSimulation(police, g, ORG), police, g, "5000", null);

    assertThat(r.montantCouvert()).isEqualByComparingTo("2400");
    assertThat(r.trace().regleOrigine()).isEqualTo("AUCUNE_CONVENTION");
    assertThat(r.trace().tarifReconnu()).isEqualByComparingTo("5000");
    assertThat(r.trace().ecart()).isEqualByComparingTo("0");
    assertThat(r.trace().conventionId()).isNull();
  }

  @Test
  @DisplayName("Hospitalisation par le dossier de l'acte : type de visite lu via acte_dossier_id → valeur hospitalisation")
  void hospitalisationViaLActe() {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    UUID acteDossier = UUID.randomUUID();
    convention("PATIENT", false);
    cotation("B", "2.5");
    valeurLettre("B", "AMBULATOIRE", "1000.00");
    valeurLettre("B", "HOSPITALISATION", "1500.00");
    when(repo.typeVisiteDeActe(acteDossier)).thenReturn("HOSPITALISATION_MEDICALE");

    ResultatLigne r = simuler(repoPourSimulation(police, g, ORG), police, g, "5000", acteDossier);

    assertThat(r.trace().tarifReconnu()).isEqualByComparingTo("3750");
    assertThat(r.montantCouvert()).isEqualByComparingTo("1400"); // (3750 − 2000) × 80 %
  }

  @Test
  @DisplayName("Cumul sur montants ARRONDIS : deux lignes de 466,4 → 466 chacune ; le plafond restant diminue de 466 puis 932")
  void cumulSurMontantsArrondis() {
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    convention("PATIENT", false);
    cotation("B", "2.5");
    valeurLettre("B", "AMBULATOIRE", "1033.00"); // reconnu 2583 → 466

    AdjudicationRepository r0 = repoPourSimulation(police, g, ORG);
    List<ResultatLigne> r = new SimulationService(r0, Clock.fixed(Instant.parse("2026-06-15T12:00:00Z"), ZoneOffset.UTC))
        .simuler(new Demande(police, JeuDeDonneesReference.ADHERENT_ID, null, ETAB, SOINS,
            List.of(new Ligne(g, new BigDecimal("5000"), CODE), new Ligne(g, new BigDecimal("5000"), CODE))));

    assertThat(r.get(0).montantCouvert()).isEqualByComparingTo("466");
    assertThat(r.get(1).montantCouvert()).isEqualByComparingTo("466");
    assertThat(r.get(0).plafondRestantApres()).isEqualByComparingTo("99534");
    assertThat(r.get(1).plafondRestantApres()).isEqualByComparingTo("99068");
  }

  // ----------------------------------------------------------------------------------------------
  // réclamation et facture : mêmes décisions, mêmes montants

  @ParameterizedTest(name = "{0}")
  @CsvSource(delimiter = '|', value = {
      "forfait 3000, prix 5000, PATIENT            | FORFAIT | PATIENT | 5000 | AUTO_ADJUDIQUE | | 800",
      "forfait 3000, prix 5000, REJET              | FORFAIT | REJET   | 5000 | REJETE         | E015 | 0",
      "forfait 3000, prix 2500                     | FORFAIT | REJET   | 2500 | AUTO_ADJUDIQUE | | 400",
      "valeur propre 1400 × 2,5 = 3500             | PROPRE  | PATIENT | 5000 | AUTO_ADJUDIQUE | | 1200",
      "lettre-clé 1033 × 2,5 → 2583 arrondi        | LETTRE  | PATIENT | 5000 | AUTO_ADJUDIQUE | | 466",
      "lettre-clé hospitalisation 1500 × 2,5       | HOSPIT  | PATIENT | 5000 | AUTO_ADJUDIQUE | | 1400",
      "non tarifable                               | NONTAR  | PATIENT | 5000 | REJETE         | E016 | 0",
      "aucune convention                           | AUCUNE  | PATIENT | 5000 | AUTO_ADJUDIQUE | | 2400",
  })
  @DisplayName("Réclamation et facture : MÊME résolveur → mêmes décisions, mêmes codes, mêmes montants")
  void memesResultatsReclamationEtFacture(
      String cas, String scenario, String politique, String prix, String decision, String code, String montant) {
    final String sc = scenario.trim();
    final boolean hospit = sc.equals("HOSPIT");
    if (sc.equals("AUCUNE")) {
      when(repo.conventionEnVigueur(ORG, ETAB, SOINS)).thenReturn(Optional.empty());
    } else {
      convention(politique.trim(), false);
      switch (sc) {
        case "FORFAIT" -> forfait("3000.00");
        case "PROPRE" -> {
          valeurPropre("1400.00");
          cotation("B", "2.5");
        }
        case "LETTRE" -> {
          cotation("B", "2.5");
          valeurLettre("B", "AMBULATOIRE", "1033.00");
        }
        case "HOSPIT" -> {
          cotation("B", "2.5");
          valeurLettre("B", "AMBULATOIRE", "1000.00");
          valeurLettre("B", "HOSPITALISATION", "1500.00");
        }
        default -> cotation("B", "2.5"); // NONTAR : aucune valeur de lettre-clé
      }
    }
    final String typeVisite = hospit ? "HOSPITALISATION_MEDICALE" : null;

    // --- facture (simulation)
    UUID g = UUID.randomUUID();
    UUID police = UUID.randomUUID();
    ResultatLigne f = simuler(repoPourSimulation(police, g, ORG), police, g, prix.trim(), null, typeVisite);

    // --- réclamation (même dépôt de conventions, tarif résolu par le même ResolveurTarif)
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal(prix.trim()));
    when(repo.chargerContexte(ctx.id())).thenReturn(Optional.of(ctx));
    when(repo.contexteTarifReclamation(ctx.id()))
        .thenReturn(Optional.of(new ContexteTarif(ORG, ETAB, null, CODE, SOINS, typeVisite)));
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(BigDecimal.ZERO);
    when(repo.insererRemboursement(any(), any(), any(), any(), anyLong())).thenReturn(UUID.randomUUID());
    when(repo.majStatut(org.mockito.ArgumentMatchers.eq(ctx.id()), any())).thenReturn(1);
    DecisionResponse r = new AdjudicationService(repo).evaluer(ctx.id());

    List<String> codes = code == null || code.isBlank() ? List.of() : List.of(code.trim());
    assertThat(r.decision()).as("réclamation").isEqualTo(decision.trim());
    assertThat(r.codesRejet()).as("réclamation").isEqualTo(codes);
    assertThat(r.montantRembourse()).as("réclamation").isEqualByComparingTo(montant.trim());
    assertThat(f.decision().name()).as("facture").isEqualTo(r.decision());
    assertThat(f.codesRejet()).as("facture").isEqualTo(r.codesRejet());
    assertThat(f.montantCouvert()).as("facture").isEqualByComparingTo(r.montantRembourse());
  }

  // ----------------------------------------------------------------------------------------------
  // fixtures de simulation

  private AdjudicationRepository repoPourSimulation(UUID police, UUID garantie, UUID organisation) {
    when(repo.chargerPolice(police)).thenReturn(Optional.of(new PoliceApplicable(
        police, organisation, JeuDeDonneesReference.PRODUIT_ID, "ACTIVE",
        LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), "ANNEE_CIVILE", 90)));
    when(repo.chargerGarantie(garantie)).thenReturn(Optional.of(new GarantieApplicable(
        garantie, JeuDeDonneesReference.PRODUIT_ID, "CONSULTATION", JeuDeDonneesReference.TAUX_PCT,
        JeuDeDonneesReference.PLAFOND_PAR_ACTE, JeuDeDonneesReference.PLAFOND_ANNUEL, null,
        JeuDeDonneesReference.FRANCHISE, null, 0, "TOUT_RESEAU")));
    when(repo.titulaireDe(JeuDeDonneesReference.ADHERENT_ID, null)).thenReturn(JeuDeDonneesReference.ADHERENT_ID);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(BigDecimal.ZERO);
    return repo;
  }

  private ResultatLigne simuler(
      AdjudicationRepository r, UUID police, UUID garantie, String prix, UUID acteDossier) {
    return simuler(r, police, garantie, prix, acteDossier, null);
  }

  private ResultatLigne simuler(
      AdjudicationRepository r, UUID police, UUID garantie, String prix, UUID acteDossier, String typeVisite) {
    return new SimulationService(r, Clock.fixed(Instant.parse("2026-06-15T12:00:00Z"), ZoneOffset.UTC))
        .simuler(new Demande(police, JeuDeDonneesReference.ADHERENT_ID, null, ETAB, SOINS,
            List.of(new Ligne(garantie, new BigDecimal(prix), CODE, acteDossier, null)), typeVisite))
        .get(0);
  }
}
