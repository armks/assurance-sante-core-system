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
import ci.assurance.adjudication.web.dto.DecisionResponse;
import java.math.BigDecimal;
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
    when(repo.sommeRemboursementsAnnee(JeuDeDonneesReference.ADHERENT_ID))
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
    when(repo.sommeRemboursementsAnnee(any())).thenReturn(new BigDecimal("0.00"));
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
    when(repo.sommeRemboursementsAnnee(any())).thenReturn(new BigDecimal("0.00"));
    when(repo.insererRemboursement(any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyLong()))
        .thenReturn(UUID.randomUUID());
    when(repo.majStatut(any(), any())).thenReturn(0);

    assertThatThrownBy(() -> service.evaluer(ID)).isInstanceOf(MauvaisStatut.class);
  }

  private static ContexteAdjudication avecStatut(ContexteAdjudication c, String statut) {
    return new ContexteAdjudication(
        c.id(), c.organisationId(), c.dossierSoinsId(), c.acteDossierId(),
        c.adherentId(), c.beneficiaireId(), c.policeId(), c.garantieId(),
        c.montant(), c.typeReclamation(), statut, c.createdAt(),
        c.tauxCouverturePct(), c.plafondParActe(), c.plafondAnnuel(), c.franchise(),
        c.ticketModerateurPct(), c.delaiCarenceJours(), c.reseauSoins(),
        c.policeStatut(), c.policeDebut(), c.policeFin(),
        c.etablissementId(), c.tarifConvention());
  }
}
