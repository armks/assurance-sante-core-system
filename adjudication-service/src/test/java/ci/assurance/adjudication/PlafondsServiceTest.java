package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ci.assurance.adjudication.domain.AdjudicationExceptions.DemandeInvalide;
import ci.assurance.adjudication.domain.AdjudicationRepository;
import ci.assurance.adjudication.domain.GarantieApplicable;
import ci.assurance.adjudication.domain.PlafondsService;
import ci.assurance.adjudication.domain.PoliceApplicable;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** État des plafonds d'une famille, affiché à l'adhérent et à sa société (prisma/sql/069). */
class PlafondsServiceTest {

  private static final UUID POLICE = UUID.randomUUID();
  private static final UUID PRODUIT = UUID.randomUUID();
  private static final UUID TITULAIRE = UUID.randomUUID();
  private static final UUID ENFANT = UUID.randomUUID();
  private static final UUID G = UUID.randomUUID();

  @Test
  @DisplayName("Restant par personne et pour la famille, période de la police (année de police)")
  void etat() {
    AdjudicationRepository repo = mock(AdjudicationRepository.class);
    when(repo.chargerPolice(POLICE)).thenReturn(Optional.of(new PoliceApplicable(
        POLICE, UUID.randomUUID(), PRODUIT, "ACTIVE", LocalDate.of(2025, 3, 1), null, "ANNEE_POLICE", 90)));
    when(repo.garantiesAvecPlafondAnnuel(PRODUIT)).thenReturn(List.of(new GarantieApplicable(
        G, PRODUIT, "CONSULTATION", new BigDecimal("80"), null,
        new BigDecimal("30000.00"), new BigDecimal("50000.00"), null, null, 0, "TOUT_RESEAU")));
    when(repo.beneficiairesDe(TITULAIRE)).thenReturn(List.of(ENFANT));
    when(repo.sommeConsommeePersonne(eq(TITULAIRE), eq(null), eq(G), any(), any())).thenReturn(new BigDecimal("12000"));
    when(repo.sommeConsommeePersonne(eq(null), eq(ENFANT), eq(G), any(), any())).thenReturn(new BigDecimal("31000"));
    when(repo.sommeConsommeeFamille(eq(TITULAIRE), eq(G), any(), any())).thenReturn(new BigDecimal("43000"));

    PlafondsService.Etat e = new PlafondsService(repo).etat(POLICE, TITULAIRE, LocalDate.of(2026, 10, 7));

    assertThat(e.periode().debut()).isEqualTo(LocalDate.of(2026, 3, 1));
    assertThat(e.periode().finExclue()).isEqualTo(LocalDate.of(2027, 3, 1));
    PlafondsService.EtatGarantie g = e.garanties().get(0);
    assertThat(g.categorieActe()).isEqualTo("CONSULTATION");
    assertThat(g.consommeFamille()).isEqualByComparingTo("43000.00");
    assertThat(g.restantFamille()).isEqualByComparingTo("7000.00");
    assertThat(g.personnes()).hasSize(2);
    assertThat(g.personnes().get(0).adherentId()).isEqualTo(TITULAIRE);
    assertThat(g.personnes().get(0).restant()).isEqualByComparingTo("18000.00");
    // dépassement historique (31000 > 30000) : restant plancher 0, jamais négatif
    assertThat(g.personnes().get(1).beneficiaireId()).isEqualTo(ENFANT);
    assertThat(g.personnes().get(1).restant()).isEqualByComparingTo("0.00");
  }

  @Test
  @DisplayName("Police ou titulaire manquant → 400")
  void demandeIncomplete() {
    PlafondsService s = new PlafondsService(mock(AdjudicationRepository.class));
    assertThatThrownBy(() -> s.etat(null, TITULAIRE, null)).isInstanceOf(DemandeInvalide.class);
    assertThatThrownBy(() -> s.etat(POLICE, null, null)).isInstanceOf(DemandeInvalide.class);
  }
}
