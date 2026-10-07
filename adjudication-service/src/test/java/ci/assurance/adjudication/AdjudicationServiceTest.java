package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ci.assurance.adjudication.domain.AdjudicationExceptions.Doublon;
import ci.assurance.adjudication.domain.AdjudicationExceptions.MauvaisStatut;
import ci.assurance.adjudication.domain.AdjudicationExceptions.ReclamationIntrouvable;
import ci.assurance.adjudication.domain.AdjudicationRepository;
import ci.assurance.adjudication.domain.AdjudicationService;
import ci.assurance.adjudication.domain.ContexteAdjudication;
import ci.assurance.adjudication.domain.PeriodeCumul;
import ci.assurance.adjudication.web.dto.DecisionResponse;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Tests d'orchestration : la transaction, l'idempotence (statut / doublon) et la
 * cohérence des écritures — sans base de données (repo mocké).
 */
@ExtendWith(MockitoExtension.class)
class AdjudicationServiceTest {

  @Mock private AdjudicationRepository repo;
  private AdjudicationService service;

  private static final UUID ID = JeuDeDonneesReference.RECLAMATION_ID;
  /** Période du produit de référence (année civile) contenant la date des soins. */
  private static final PeriodeCumul PERIODE =
      PeriodeCumul.courante("ANNEE_CIVILE", null, JeuDeDonneesReference.DATE_SOINS);

  @BeforeEach
  void init() {
    service = new AdjudicationService(repo);
  }

  @Test
  @DisplayName("Réclamation absente → ReclamationIntrouvable (404), aucune écriture")
  void introuvable() {
    when(repo.chargerContexte(ID)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.evaluer(ID)).isInstanceOf(ReclamationIntrouvable.class);
    verify(repo, never()).insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong());
  }

  @Test
  @DisplayName("Statut ≠ EN_ADJUDICATION → MauvaisStatut (409), aucune écriture")
  void mauvaisStatut() {
    ContexteAdjudication ctx =
        avecStatut(JeuDeDonneesReference.actif(new BigDecimal("25000.00")), "AUTO_ADJUDIQUE");
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));

    assertThatThrownBy(() -> service.evaluer(ID)).isInstanceOf(MauvaisStatut.class);
    verify(repo, never()).verrouillerPourPlafond(any());
    verify(repo, never()).insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong());
  }

  @Test
  @DisplayName("Cas doublon : un remboursement existe déjà → Doublon (409), aucune écriture")
  void doublon() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(true);

    assertThatThrownBy(() -> service.evaluer(ID)).isInstanceOf(Doublon.class);
    verify(repo, never()).insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong());
    verify(repo, never()).majStatut(any(), any());
  }

  @Test
  @DisplayName("Cas normal complet : insère 18400.00, passe la réclamation à AUTO_ADJUDIQUE, journalise")
  void casNormalComplet() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(JeuDeDonneesReference.ADHERENT_ID, null, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE))
        .thenReturn(new BigDecimal("0.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, "AUTO_ADJUDIQUE")).thenReturn(1);

    DecisionResponse res = service.evaluer(ID);

    assertThat(res.decision()).isEqualTo("AUTO_ADJUDIQUE");
    assertThat(res.montantRembourse()).isEqualByComparingTo("18400.00");
    assertThat(res.codesRejet()).isEmpty();
    assertThat(res.plafondRestantApres()).isEqualByComparingTo("81600.00");
    assertThat(res.dureeTraitementMs()).isGreaterThanOrEqualTo(0);

    verify(repo).verrouillerPourPlafond(JeuDeDonneesReference.ADHERENT_ID);
    verify(repo).insererRemboursement(
        eq(ID), eq(new BigDecimal("18400.00")), eq(new BigDecimal("81600.00")),
        eq("AUTO_ADJUDIQUE"), org.mockito.ArgumentMatchers.anyLong());
    verify(repo).majStatut(ID, "AUTO_ADJUDIQUE");
    verify(repo).journaliser(eq(ID), eq(AdjudicationService.UTILISATEUR_SVC), any());
  }

  @Test
  @DisplayName("Police inactive : REJETE E001, insère un remboursement à 0.00, statut REJETE")
  void policeInactive() {
    ContexteAdjudication ctx =
        JeuDeDonneesReference.contexte(new BigDecimal("25000.00"), "RESILIEE");
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(new BigDecimal("0.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, "REJETE")).thenReturn(1);

    DecisionResponse res = service.evaluer(ID);

    assertThat(res.decision()).isEqualTo("REJETE");
    assertThat(res.montantRembourse()).isEqualByComparingTo("0.00");
    assertThat(res.codesRejet()).containsExactly("E001");
    verify(repo).majStatut(ID, "REJETE");
  }

  @Test
  @DisplayName("Réclamation modifiée pendant l'adjudication (majStatut renvoie 0) → 409")
  void statutChangePendant() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(new BigDecimal("0.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(any(), any())).thenReturn(0);

    assertThatThrownBy(() -> service.evaluer(ID)).isInstanceOf(MauvaisStatut.class);
  }

  // --- Plafond annuel d'un BÉNÉFICIAIRE (adherent_id NULL sur ses réclamations) ---
  // Avant correctif : cumul cherché par adherent_id = NULL → toujours 0, le
  // plafond annuel ne s'appliquait jamais aux bénéficiaires.

  @Test
  @DisplayName("Bénéficiaire : cumul et verrou sur SA personne — 1re réclamation 18400.00, restant 81600.00")
  void beneficiairePremiereReclamation() {
    ContexteAdjudication ctx = JeuDeDonneesReference.beneficiaireActif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(null, JeuDeDonneesReference.BENEFICIAIRE_ID, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE))
        .thenReturn(new BigDecimal("0.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, "AUTO_ADJUDIQUE")).thenReturn(1);

    DecisionResponse res = service.evaluer(ID);

    assertThat(res.montantRembourse()).isEqualByComparingTo("18400.00");
    assertThat(res.plafondRestantApres()).isEqualByComparingTo("81600.00");
    verify(repo).verrouillerPourPlafond(JeuDeDonneesReference.BENEFICIAIRE_ID);
    verify(repo).sommeConsommeePersonne(null, JeuDeDonneesReference.BENEFICIAIRE_ID, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE);
    verify(repo, never()).verrouillerPourPlafond(JeuDeDonneesReference.POLICE_ID);
  }

  @Test
  @DisplayName("Bénéficiaire ayant déjà 90000.00 remboursés : borné à 10000.00, REVUE_MANUELLE E006, restant 0.00")
  void beneficiairePlafondPresqueAtteint() {
    ContexteAdjudication ctx = JeuDeDonneesReference.beneficiaireActif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(null, JeuDeDonneesReference.BENEFICIAIRE_ID, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE))
        .thenReturn(new BigDecimal("90000.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, "REVUE_MANUELLE")).thenReturn(1);

    DecisionResponse res = service.evaluer(ID);

    assertThat(res.decision()).isEqualTo("REVUE_MANUELLE");
    assertThat(res.montantRembourse()).isEqualByComparingTo("10000.00");
    assertThat(res.codesRejet()).containsExactly("E006");
    assertThat(res.plafondRestantApres()).isEqualByComparingTo("0.00");
    verify(repo).insererRemboursement(
        eq(ID), eq(new BigDecimal("10000.00")), eq(new BigDecimal("0.00")),
        eq("REVUE_MANUELLE"), org.mockito.ArgumentMatchers.anyLong());
  }

  @Test
  @DisplayName("Bénéficiaire au plafond (100000.00 déjà remboursés) : REJETE E006, 0.00")
  void beneficiairePlafondAtteint() {
    ContexteAdjudication ctx = JeuDeDonneesReference.beneficiaireActif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(null, JeuDeDonneesReference.BENEFICIAIRE_ID, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE))
        .thenReturn(new BigDecimal("100000.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, "REJETE")).thenReturn(1);

    DecisionResponse res = service.evaluer(ID);

    assertThat(res.decision()).isEqualTo("REJETE");
    assertThat(res.montantRembourse()).isEqualByComparingTo("0.00");
    assertThat(res.codesRejet()).containsExactly("E006");
  }

  @Test
  @DisplayName("Adhérent titulaire inchangé : cumul et verrou sur l'adhérent, jamais sur un bénéficiaire")
  void titulaireInchange() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(JeuDeDonneesReference.ADHERENT_ID, null, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE))
        .thenReturn(new BigDecimal("0.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, "AUTO_ADJUDIQUE")).thenReturn(1);

    service.evaluer(ID);

    verify(repo).verrouillerPourPlafond(JeuDeDonneesReference.ADHERENT_ID);
    verify(repo).sommeConsommeePersonne(JeuDeDonneesReference.ADHERENT_ID, null, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE);
  }

  // --- Plafond annuel PAR GARANTIE ---
  // Avant correctif : remboursements de toutes les garanties additionnés puis
  // comparés au plafond de la garantie de la réclamation.

  @Test
  @DisplayName("Plafond par garantie : 100000.00 remboursés sur une AUTRE garantie n'entament pas celle-ci — 18400.00, restant 81600.00")
  void autreGarantieNentamePasLePlafond() {
    ContexteAdjudication ctx = JeuDeDonneesReference.actif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.remboursementExiste(ID)).thenReturn(false);
    // toute autre garantie de l'adhérent : plafond (100000.00) déjà consommé…
    when(repo.sommeConsommeePersonne(eq(JeuDeDonneesReference.ADHERENT_ID), org.mockito.ArgumentMatchers.isNull(), any(), any(), any()))
        .thenReturn(new BigDecimal("100000.00"));
    // … mais rien sur la garantie de CETTE réclamation
    when(repo.sommeConsommeePersonne(JeuDeDonneesReference.ADHERENT_ID, null, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE))
        .thenReturn(new BigDecimal("0.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, "AUTO_ADJUDIQUE")).thenReturn(1);

    DecisionResponse res = service.evaluer(ID);

    assertThat(res.decision()).isEqualTo("AUTO_ADJUDIQUE");
    assertThat(res.montantRembourse()).isEqualByComparingTo("18400.00");
    assertThat(res.plafondRestantApres()).isEqualByComparingTo("81600.00");
    verify(repo).sommeConsommeePersonne(
        JeuDeDonneesReference.ADHERENT_ID, null, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE);
  }

  // --- Plafond FAMILLE (prisma/sql/069) : cumul et verrou sur le titulaire ---

  private void stubEcritures(String decision) {
    when(repo.remboursementExiste(ID)).thenReturn(false);
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(ID, decision)).thenReturn(1);
  }

  @Test
  @DisplayName("Bénéficiaire, produit avec plafond famille : verrou ET cumul famille sur le TITULAIRE — 35000 sur 40000 → 5000.00")
  void beneficiairePlafondFamilleSurLeTitulaire() {
    ContexteAdjudication ctx =
        JeuDeDonneesReference.avecPlafonds(
            JeuDeDonneesReference.beneficiaireActif(new BigDecimal("25000.00")),
            new BigDecimal("100000.00"),
            new BigDecimal("40000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.produitAPlafondFamille(JeuDeDonneesReference.PRODUIT_ID)).thenReturn(true);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(new BigDecimal("5000.00"));
    when(repo.sommeConsommeeFamille(
            JeuDeDonneesReference.ADHERENT_ID, JeuDeDonneesReference.GARANTIE_ID, java.util.List.of(), PERIODE))
        .thenReturn(new BigDecimal("35000.00"));
    stubEcritures("REVUE_MANUELLE");

    DecisionResponse res = service.evaluer(ID);

    assertThat(res.montantRembourse()).isEqualByComparingTo("5000.00");
    assertThat(res.codesRejet()).containsExactly("E006");
    verify(repo).verrouillerPourPlafond(JeuDeDonneesReference.ADHERENT_ID);
    verify(repo, never()).verrouillerPourPlafond(JeuDeDonneesReference.BENEFICIAIRE_ID);
  }

  @Test
  @DisplayName("Deux bénéficiaires d'une même famille (plafond famille) : MÊME clé de verrou, le titulaire — leurs adjudications sont sérialisées")
  void deuxBeneficiairesMemeVerrou() {
    UUID autreBeneficiaire = UUID.fromString("88888888-8888-4888-8888-888888888888");
    ContexteAdjudication b1 =
        JeuDeDonneesReference.avecPlafonds(
            JeuDeDonneesReference.beneficiaireActif(new BigDecimal("25000.00")), null, new BigDecimal("40000.00"));
    ContexteAdjudication b2 =
        new ContexteAdjudication(
            b1.id(), b1.organisationId(), b1.dossierSoinsId(), b1.acteDossierId(),
            null, autreBeneficiaire, b1.policeId(), b1.garantieId(),
            b1.montant(), b1.typeReclamation(), b1.statut(), b1.createdAt(),
            b1.tauxCouverturePct(), b1.plafondParActe(),
            b1.plafondAnnuelPersonne(), b1.plafondAnnuelFamille(), b1.franchise(),
            b1.ticketModerateurPct(), b1.delaiCarenceJours(), b1.reseauSoins(),
            b1.policeStatut(), b1.policeDebut(), b1.policeFin(),
            b1.etablissementId(), b1.tarifConvention(),
            b1.produitId(), JeuDeDonneesReference.ADHERENT_ID, b1.periodeCumul(), b1.dateSoins());
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(b1), Optional.of(b2));
    when(repo.produitAPlafondFamille(JeuDeDonneesReference.PRODUIT_ID)).thenReturn(true);
    when(repo.sommeConsommeeFamille(any(), any(), any(), any())).thenReturn(new BigDecimal("0.00"));
    stubEcritures("AUTO_ADJUDIQUE");

    service.evaluer(ID);
    service.evaluer(ID);

    verify(repo, org.mockito.Mockito.times(2)).verrouillerPourPlafond(JeuDeDonneesReference.ADHERENT_ID);
    verify(repo, org.mockito.Mockito.times(2))
        .sommeConsommeeFamille(eq(JeuDeDonneesReference.ADHERENT_ID), any(), any(), any());
  }

  @Test
  @DisplayName("Produit SANS plafond famille : verrou sur la personne (bénéficiaire), aucun cumul famille")
  void sansPlafondFamilleVerrouPersonne() {
    ContexteAdjudication ctx = JeuDeDonneesReference.beneficiaireActif(new BigDecimal("25000.00"));
    when(repo.chargerContexte(ID)).thenReturn(Optional.of(ctx));
    when(repo.produitAPlafondFamille(JeuDeDonneesReference.PRODUIT_ID)).thenReturn(false);
    when(repo.sommeConsommeePersonne(any(), any(), any(), any(), any())).thenReturn(new BigDecimal("0.00"));
    stubEcritures("AUTO_ADJUDIQUE");

    service.evaluer(ID);

    verify(repo).verrouillerPourPlafond(JeuDeDonneesReference.BENEFICIAIRE_ID);
    verify(repo, never()).sommeConsommeeFamille(any(), any(), any(), any());
  }

  private static ContexteAdjudication avecStatut(ContexteAdjudication c, String statut) {
    return new ContexteAdjudication(
        c.id(), c.organisationId(), c.dossierSoinsId(), c.acteDossierId(),
        c.adherentId(), c.beneficiaireId(), c.policeId(), c.garantieId(),
        c.montant(), c.typeReclamation(), statut, c.createdAt(),
        c.tauxCouverturePct(), c.plafondParActe(),
        c.plafondAnnuelPersonne(), c.plafondAnnuelFamille(), c.franchise(),
        c.ticketModerateurPct(), c.delaiCarenceJours(), c.reseauSoins(),
        c.policeStatut(), c.policeDebut(), c.policeFin(),
        c.etablissementId(), c.tarifConvention(),
        c.produitId(), c.titulaireId(), c.periodeCumul(), c.dateSoins());
  }
}
