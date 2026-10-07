package ci.assurance.adjudication.repo;

import ci.assurance.adjudication.domain.Adjudicateur;
import ci.assurance.adjudication.domain.AdjudicationRepository;
import ci.assurance.adjudication.domain.ContexteAdjudication;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * Implémentation JDBC — connexion via le rôle Postgres {@code svc_adjudication}
 * (grants stricts : SELECT colonnes précises sur reclamations/dossiers_soins/
 * actes_dossier, SELECT complet sur garanties/polices/referentiel_actes/
 * tarifs_conventionnes/grilles_tarifaires/medicaments, UPDATE(statut) sur
 * reclamations, INSERT sur remboursements, EXECUTE sur log_audit — prisma/sql/018
 * puis 034 pour l'ajout dossiers_soins/actes_dossier).
 *
 * Toutes les requêtes ci-dessous n'utilisent QUE des colonnes autorisées à ce rôle.
 */
@Repository
public class JdbcAdjudicationRepository implements AdjudicationRepository {

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  public JdbcAdjudicationRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  // Tarif conventionné (v3 §5) : jointure dossiers_soins -> etablissement_id,
  // puis actes_dossier.code_acte -> referentiel_actes.code (seul lien existant
  // entre un acte réclamé et le référentiel, code_acte étant optionnel côté
  // saisie) -> tarifs_conventionnes sur (etablissement_id, referentiel_acte_id),
  // filtré sur la période de validité du tarif. LEFT JOIN partout : absence de
  // tarif négocié (ou de code_acte renseigné) -> tarif_convention NULL ->
  // comportement de calcul inchangé (Adjudicateur).
  private static final String SQL_CONTEXTE =
      """
      SELECT
        r.id, r.organisation_id, r.dossier_soins_id, r.acte_dossier_id,
        r.adherent_id, r.beneficiaire_id, r.police_id, r.garantie_id,
        r.montant, r.type_reclamation, r.statut, r.created_at,
        g.taux_couverture, g.plafond_par_acte, g.plafond_annuel, g.franchise,
        g.ticket_moderateur, g.delai_carence_jours, g.reseau_soins,
        p.statut      AS police_statut,
        p.date_debut  AS police_debut,
        p.date_fin    AS police_fin,
        ds.etablissement_id AS etablissement_id,
        tc.tarif_convention AS tarif_convention
      FROM reclamations r
      JOIN garanties     g  ON g.id = r.garantie_id AND g.deleted_at IS NULL
      JOIN polices       p  ON p.id = r.police_id   AND p.deleted_at IS NULL
      LEFT JOIN dossiers_soins    ds ON ds.id = r.dossier_soins_id
      LEFT JOIN actes_dossier     ad ON ad.id = r.acte_dossier_id AND ad.deleted_at IS NULL
      LEFT JOIN referentiel_actes ra ON ra.code = ad.code_acte AND ra.deleted_at IS NULL
      LEFT JOIN tarifs_conventionnes tc
        ON tc.etablissement_id = ds.etablissement_id
        AND tc.referentiel_acte_id = ra.id
        AND tc.deleted_at IS NULL
        AND tc.date_debut <= r.created_at::date
        AND (tc.date_fin IS NULL OR tc.date_fin >= r.created_at::date)
      WHERE r.id = ? AND r.deleted_at IS NULL
      """;

  private static final RowMapper<ContexteAdjudication> MAPPER =
      (ResultSet rs, int n) -> new ContexteAdjudication(
          uuid(rs, "id"),
          uuid(rs, "organisation_id"),
          uuid(rs, "dossier_soins_id"),
          uuid(rs, "acte_dossier_id"),
          uuid(rs, "adherent_id"),
          uuid(rs, "beneficiaire_id"),
          uuid(rs, "police_id"),
          uuid(rs, "garantie_id"),
          rs.getBigDecimal("montant"),
          rs.getString("type_reclamation"),
          rs.getString("statut"),
          instant(rs, "created_at"),
          rs.getBigDecimal("taux_couverture"),
          rs.getBigDecimal("plafond_par_acte"),
          rs.getBigDecimal("plafond_annuel"),
          rs.getBigDecimal("franchise"),
          rs.getBigDecimal("ticket_moderateur"),
          (Integer) rs.getObject("delai_carence_jours"),
          rs.getString("reseau_soins"),
          rs.getString("police_statut"),
          localDate(rs, "police_debut"),
          localDate(rs, "police_fin"),
          uuid(rs, "etablissement_id"),
          rs.getBigDecimal("tarif_convention"));

  @Override
  public Optional<ContexteAdjudication> chargerContexte(UUID reclamationId) {
    try {
      return Optional.ofNullable(
          jdbc.queryForObject(SQL_CONTEXTE, MAPPER, reclamationId));
    } catch (EmptyResultDataAccessException e) {
      return Optional.empty();
    }
  }

  @Override
  public boolean remboursementExiste(UUID reclamationId) {
    Integer c =
        jdbc.queryForObject(
            "SELECT count(*) FROM remboursements WHERE reclamation_id = ?",
            Integer.class,
            reclamationId);
    return c != null && c > 0;
  }

  @Override
  public void verrouillerPourPlafond(UUID cle) {
    // verrou pessimiste transactionnel : sérialise les adjudications concurrentes
    // portant sur la même clé (adhérent). Relâché au commit / rollback.
    // `pg_advisory_xact_lock` renvoie void → on n'exploite pas de valeur.
    jdbc.query(
        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
        rs -> {
          /* void */
        },
        cle.toString());
  }

  @Override
  public BigDecimal sommeRemboursementsAnnee(UUID adherentId, UUID beneficiaireId) {
    // Cumul par PERSONNE assurée. Avant correctif, seul `rc.adherent_id = ?`
    // existait : pour un bénéficiaire (adherent_id NULL) le paramètre était
    // NULL, `= NULL` ne correspond à rien, cumul = 0 → plafond annuel jamais
    // appliqué aux bénéficiaires.
    final String colonne;
    final UUID personne;
    if (adherentId != null) {
      colonne = "adherent_id";
      personne = adherentId;
    } else if (beneficiaireId != null) {
      colonne = "beneficiaire_id";
      personne = beneficiaireId;
    } else {
      return BigDecimal.ZERO;
    }
    BigDecimal somme =
        jdbc.queryForObject(
            """
            SELECT COALESCE(SUM(rb.montant_rembourse), 0)
            FROM remboursements rb
            JOIN reclamations  rc ON rc.id = rb.reclamation_id
            WHERE rc.%s = ?
              AND rb.created_at >= date_trunc('year', now())
            """
                .formatted(colonne),
            BigDecimal.class,
            personne);
    return somme == null ? BigDecimal.ZERO : somme;
  }

  @Override
  public UUID insererRemboursement(
      UUID reclamationId,
      BigDecimal montantRembourse,
      BigDecimal plafondRestantApres,
      String decision,
      long dureeTraitementMs) {
    return jdbc.queryForObject(
        """
        INSERT INTO remboursements
          (reclamation_id, montant_rembourse, plafond_restant_apres, decision, duree_traitement_ms)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
        """,
        UUID.class,
        reclamationId,
        montantRembourse,
        plafondRestantApres,
        decision,
        (int) dureeTraitementMs);
  }

  @Override
  public int majStatut(UUID reclamationId, String statut) {
    return jdbc.update(
        "UPDATE reclamations SET statut = ? WHERE id = ? AND statut = 'EN_ADJUDICATION'",
        statut,
        reclamationId);
  }

  @Override
  public void journaliser(UUID reclamationId, UUID svcUserId, Adjudicateur.Resultat r) {
    Map<String, Object> details = new LinkedHashMap<>();
    details.put("decision", r.decision().name());
    details.put("montant_rembourse", r.montantRembourse());
    details.put("codes_rejet", r.codesRejet());
    details.put("plafond_restant_apres", r.plafondRestantApres());
    final String json;
    try {
      json = mapper.writeValueAsString(details);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Sérialisation des détails d'audit impossible", e);
    }
    // `log_audit` renvoie void → on exécute le SELECT sans lire de valeur.
    jdbc.query(
        "SELECT log_audit(?, ?, ?, ?, ?::jsonb)",
        rs -> {
          /* void : rien à lire */
        },
        "ADJUDICATION_" + r.decision().name(),
        "reclamations",
        reclamationId,
        svcUserId,
        json);
  }

  // --- helpers de mapping ---

  private static UUID uuid(ResultSet rs, String col) throws SQLException {
    Object v = rs.getObject(col);
    return v == null ? null : (v instanceof UUID u ? u : UUID.fromString(v.toString()));
  }

  private static Instant instant(ResultSet rs, String col) throws SQLException {
    OffsetDateTime odt = rs.getObject(col, OffsetDateTime.class);
    return odt == null ? null : odt.toInstant();
  }

  private static LocalDate localDate(ResultSet rs, String col) throws SQLException {
    return rs.getObject(col, LocalDate.class);
  }
}
