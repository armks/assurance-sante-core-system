package ci.assurance.adjudication.domain;

import ci.assurance.adjudication.web.dto.DecisionResponse;
import ci.assurance.adjudication.domain.AdjudicationExceptions.Doublon;
import ci.assurance.adjudication.domain.AdjudicationExceptions.MauvaisStatut;
import ci.assurance.adjudication.domain.AdjudicationExceptions.ReclamationIntrouvable;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Orchestration de l'adjudication d'UNE réclamation, dans UNE SEULE transaction
 * JDBC ({@link Transactional}) — v12 §2/§3 :
 *
 * <ol>
 *   <li>SELECT réclamation + garantie applicable + police ;</li>
 *   <li>vérif. statut EN_ADJUDICATION (409 sinon) + doublon (409) ;</li>
 *   <li>verrou pessimiste transactionnel keyé sur la personne, ou la famille si le
 *       produit a un plafond famille ({@code pg_advisory_xact_lock}), puis cumuls de
 *       la période par personne et par famille ;</li>
 *   <li>calcul {@link Adjudicateur} (BigDecimal) ;</li>
 *   <li>INSERT {@code remboursements} RETURNING id + UPDATE {@code reclamations.statut} ;</li>
 *   <li>{@code log_audit()}.</li>
 * </ol>
 *
 * Toute exception fait remonter un ROLLBACK complet (rien de partiel n'est écrit).
 */
@Service
public class AdjudicationService {

  /**
   * Identité « système » utilisée pour {@code log_audit(p_user_id)} — le rôle
   * svc_adjudication n'a pas de profil ; l'organisation résolue sera NULL.
   */
  public static final UUID UTILISATEUR_SVC =
      UUID.fromString("00000000-0000-0000-0000-000000000024");

  private final AdjudicationRepository repo;
  private final Adjudicateur adjudicateur;

  public AdjudicationService(AdjudicationRepository repo) {
    this.repo = repo;
    this.adjudicateur = new Adjudicateur();
  }

  @Transactional
  public DecisionResponse evaluer(UUID reclamationId) {
    final long debutNs = System.nanoTime();

    final ContexteAdjudication ctx =
        repo.chargerContexte(reclamationId)
            .orElseThrow(() -> new ReclamationIntrouvable(reclamationId));

    // 2) idempotence
    if (!"EN_ADJUDICATION".equals(ctx.statut())) {
      throw new MauvaisStatut(reclamationId, ctx.statut());
    }
    if (repo.remboursementExiste(reclamationId)) {
      throw new Doublon(reclamationId);
    }

    // 3) verrou pessimiste + cumuls de la période en cours (prisma/sql/069), par
    //    GARANTIE (les plafonds appartiennent à la garantie) :
    //    - par PERSONNE (l'adhérent, ou le bénéficiaire — adherent_id NULL sur ses
    //      réclamations ; la police seulement si aucun des deux, cas non attendu) ;
    //    - par FAMILLE (titulaire + tous ses bénéficiaires) si plafond famille.
    //    Verrou sur la FAMILLE dès que le produit a un plafond famille (même règle
    //    que le core NestJS), sinon sur la personne : il sérialise toutes les
    //    adjudications et factures qui partagent un plafond, garanties confondues.
    final UUID cleVerrou =
        ctx.titulaireId() != null && repo.produitAPlafondFamille(ctx.produitId())
            ? ctx.titulaireId()
            : ctx.clePersonne();
    repo.verrouillerPourPlafond(cleVerrou);
    // période qui CONTIENT LA DATE DES SOINS (prisma/sql/070) — des soins de février
    // réclamés en mars, après l'anniversaire de la police, consomment l'ancienne période
    final LocalDate dateSoins =
        ctx.dateSoins() != null
            ? ctx.dateSoins()
            : ctx.createdAt().atZone(ZoneOffset.UTC).toLocalDate();
    final PeriodeCumul periode =
        PeriodeCumul.courante(ctx.periodeCumul(), ctx.policeDebut(), dateSoins);
    final java.math.BigDecimal dejaPersonne =
        ctx.plafondAnnuelPersonne() == null
            ? java.math.BigDecimal.ZERO
            : repo.sommeConsommeePersonne(
                ctx.adherentId(), ctx.beneficiaireId(), ctx.garantieId(), java.util.List.of(), periode);
    final java.math.BigDecimal dejaFamille =
        ctx.plafondAnnuelFamille() == null
            ? java.math.BigDecimal.ZERO
            : repo.sommeConsommeeFamille(ctx.titulaireId(), ctx.garantieId(), java.util.List.of(), periode);

    // 4) calcul
    final LocalDate dateReference =
        ctx.createdAt().atZone(ZoneOffset.UTC).toLocalDate();
    final Adjudicateur.Resultat r =
        adjudicateur.calculer(ctx, dejaPersonne, dejaFamille, dateReference);

    final long dureeMs = (System.nanoTime() - debutNs) / 1_000_000L;

    // 5) écritures
    try {
      repo.insererRemboursement(
          reclamationId,
          r.montantRembourse(),
          r.plafondRestantApres(),
          r.decision().name(),
          dureeMs);
    } catch (DuplicateKeyException e) {
      // filet de sécurité : course avec une autre adjudication (index unique)
      throw new Doublon(reclamationId);
    }

    final int majAffectees = repo.majStatut(reclamationId, r.decision().name());
    if (majAffectees == 0) {
      // la réclamation a changé de statut pendant l'adjudication -> rollback
      throw new MauvaisStatut(reclamationId, "modifié pendant l'adjudication");
    }

    // 6) audit
    repo.journaliser(reclamationId, UTILISATEUR_SVC, r);

    return new DecisionResponse(
        r.decision().name(),
        r.montantRembourse(),
        r.codesRejet(),
        r.plafondRestantApres(),
        dureeMs);
  }
}
