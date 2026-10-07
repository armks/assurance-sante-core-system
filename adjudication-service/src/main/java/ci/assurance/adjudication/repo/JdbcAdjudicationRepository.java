package ci.assurance.adjudication.repo;

import ci.assurance.adjudication.domain.Adjudicateur;
import ci.assurance.adjudication.domain.AdjudicationRepository;
import ci.assurance.adjudication.domain.ContexteAdjudication;
import ci.assurance.adjudication.domain.GarantieApplicable;
import ci.assurance.adjudication.domain.PeriodeCumul;
import ci.assurance.adjudication.domain.PoliceApplicable;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
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
        g.taux_couverture, g.plafond_par_acte, g.plafond_annuel_personne,
        g.plafond_annuel_famille, g.franchise,
        g.ticket_moderateur, g.delai_carence_jours, g.reseau_soins,
        p.statut      AS police_statut,
        p.date_debut  AS police_debut,
        p.date_fin    AS police_fin,
        ds.etablissement_id AS etablissement_id,
        tc.tarif_convention AS tarif_convention,
        g.produit_id AS produit_id,
        COALESCE(r.adherent_id, b.adherent_id) AS titulaire_id,
        pr.periode_cumul_plafond AS periode_cumul,
        pr.delai_declaration_jours AS delai_declaration_jours,
        -- date des soins (prisma/sql/070) : acte réalisé / prescrit, dispensation
        -- délivrée / préparée, à défaut la réclamation — en UTC (Côte d'Ivoire, UTC+0)
        (COALESCE(ad.date_realisation, ad.date_prescription,
                  dp.date_paiement, dp.date_preparation, r.created_at)
           AT TIME ZONE 'UTC')::date AS date_soins
      FROM reclamations r
      JOIN garanties     g  ON g.id = r.garantie_id AND g.deleted_at IS NULL
      JOIN polices       p  ON p.id = r.police_id   AND p.deleted_at IS NULL
      JOIN produits      pr ON pr.id = g.produit_id
      LEFT JOIN beneficiaires b ON b.id = r.beneficiaire_id
      LEFT JOIN dossiers_soins    ds ON ds.id = r.dossier_soins_id
      LEFT JOIN actes_dossier     ad ON ad.id = r.acte_dossier_id AND ad.deleted_at IS NULL
      LEFT JOIN dispensations_pharmacie dp ON dp.id = r.dispensation_id
      LEFT JOIN referentiel_actes ra ON ra.code = ad.code_acte AND ra.deleted_at IS NULL
      LEFT JOIN tarifs_conventionnes tc
        ON tc.etablissement_id = ds.etablissement_id
        AND tc.referentiel_acte_id = ra.id
        AND tc.deleted_at IS NULL
        -- tarif EN VIGUEUR À LA DATE DES SOINS (même expression que date_soins)
        AND tc.date_debut <= (COALESCE(ad.date_realisation, ad.date_prescription,
                                       dp.date_paiement, dp.date_preparation, r.created_at)
                                AT TIME ZONE 'UTC')::date
        AND (tc.date_fin IS NULL
             OR tc.date_fin >= (COALESCE(ad.date_realisation, ad.date_prescription,
                                         dp.date_paiement, dp.date_preparation, r.created_at)
                                  AT TIME ZONE 'UTC')::date)
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
          rs.getBigDecimal("plafond_annuel_personne"),
          rs.getBigDecimal("plafond_annuel_famille"),
          rs.getBigDecimal("franchise"),
          rs.getBigDecimal("ticket_moderateur"),
          (Integer) rs.getObject("delai_carence_jours"),
          rs.getString("reseau_soins"),
          rs.getString("police_statut"),
          localDate(rs, "police_debut"),
          localDate(rs, "police_fin"),
          uuid(rs, "etablissement_id"),
          rs.getBigDecimal("tarif_convention"),
          uuid(rs, "produit_id"),
          uuid(rs, "titulaire_id"),
          rs.getString("periode_cumul"),
          localDate(rs, "date_soins"),
          (Integer) rs.getObject("delai_declaration_jours"));

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
  public BigDecimal sommeConsommeePersonne(
      UUID adherentId,
      UUID beneficiaireId,
      UUID garantieId,
      Collection<UUID> actesExclus,
      PeriodeCumul periode) {
    // Personne : un bénéficiaire a adherent_id NULL sur ses réclamations et dossiers.
    if (adherentId != null) {
      return somme("%1$s.adherent_id = ?", List.of(adherentId), garantieId, actesExclus, periode);
    }
    if (beneficiaireId != null) {
      return somme("%1$s.beneficiaire_id = ?", List.of(beneficiaireId), garantieId, actesExclus, periode);
    }
    return BigDecimal.ZERO;
  }

  @Override
  public BigDecimal sommeConsommeeFamille(
      UUID titulaireId, UUID garantieId, Collection<UUID> actesExclus, PeriodeCumul periode) {
    if (titulaireId == null) {
      return BigDecimal.ZERO;
    }
    // Famille : le titulaire OU l'un de ses bénéficiaires (supprimés compris — leur
    // consommation passée reste imputée à la famille).
    return somme(
        "(%1$s.adherent_id = ? OR %1$s.beneficiaire_id IN"
            + " (SELECT fb.id FROM beneficiaires fb WHERE fb.adherent_id = ?))",
        List.of(titulaireId, titulaireId),
        garantieId,
        actesExclus,
        periode);
  }

  /**
   * Cumul de TOUT ce que l'assureur prend en charge sur la période, pour les personnes
   * filtrées par {@code filtrePersonne} (gabarit appliqué aux alias {@code rc} puis
   * {@code ds}) et la garantie :
   *  - les remboursements adjugés (réclamations, dont les dispensations) ;
   *  - la part assurance des lignes de facturation tiers payant
   *    (`lignes_facturation.montant_reclame`, actes facturés au centre), hors lignes
   *    reportées pour litige (`reportee_mois_suivant`). La garantie d'une ligne est
   *    celle du produit de la police pour la catégorie de l'acte — même appariement
   *    que la facture (une seule garantie active par catégorie).
   * Un acte facturé en tiers payant ne peut plus faire l'objet d'une réclamation
   * (refus côté NestJS) : pas de double comptage.
   *
   * <p>Période {@code [debut, finExclue)} appliquée à la DATE DES SOINS de chaque
   * consommation (prisma/sql/070), jamais à sa date d'enregistrement (adjudication,
   * facturation) : acte → réalisation, à défaut prescription ; dispensation →
   * délivrance, à défaut préparation ; à défaut, date de la réclamation. Dates en UTC
   * (Côte d'Ivoire, UTC+0), comme {@link ContexteAdjudication#dateSoins}.
   */
  private BigDecimal somme(
      String filtrePersonne,
      List<UUID> personnes,
      UUID garantieId,
      Collection<UUID> actesExclus,
      PeriodeCumul periode) {
    final String sql =
        """
        SELECT
          (SELECT COALESCE(SUM(rb.montant_rembourse), 0)
             FROM remboursements rb
             JOIN reclamations  rc ON rc.id = rb.reclamation_id
             LEFT JOIN actes_dossier           sa ON sa.id = rc.acte_dossier_id
             LEFT JOIN dispensations_pharmacie sd ON sd.id = rc.dispensation_id
            WHERE %1$s
              AND rc.garantie_id = ?
              AND (COALESCE(sa.date_realisation, sa.date_prescription,
                            sd.date_paiement, sd.date_preparation, rc.created_at)
                     AT TIME ZONE 'UTC')::date >= ?
              AND (COALESCE(sa.date_realisation, sa.date_prescription,
                            sd.date_paiement, sd.date_preparation, rc.created_at)
                     AT TIME ZONE 'UTC')::date < ?)
          +
          (SELECT COALESCE(SUM(lf.montant_reclame), 0)
             FROM lignes_facturation lf
             JOIN actes_dossier  ad ON ad.id = lf.acte_dossier_id AND ad.deleted_at IS NULL
             JOIN dossiers_soins ds ON ds.id = ad.dossier_soins_id
             JOIN polices        p  ON p.id = ds.police_id
             JOIN garanties      g  ON g.produit_id = p.produit_id
                                   AND g.categorie_acte = ad.categorie_acte
                                   AND g.deleted_at IS NULL
            WHERE %2$s
              AND g.id = ?
              AND lf.reportee_mois_suivant = false
              AND lf.acte_dossier_id::text <> ALL (string_to_array(?, ','))
              AND (COALESCE(ad.date_realisation, ad.date_prescription)
                     AT TIME ZONE 'UTC')::date >= ?
              AND (COALESCE(ad.date_realisation, ad.date_prescription)
                     AT TIME ZONE 'UTC')::date < ?)
        """
            .formatted(filtrePersonne.formatted("rc"), filtrePersonne.formatted("ds"));
    final List<Object> params = new ArrayList<>();
    for (int bloc = 0; bloc < 2; bloc++) {
      params.addAll(personnes);
      params.add(garantieId);
      if (bloc == 1) {
        params.add(
            actesExclus == null
                ? ""
                : String.join(",", actesExclus.stream().map(UUID::toString).toList()));
      }
      params.add(periode.debut());
      params.add(periode.finExclue());
    }
    final BigDecimal s = jdbc.queryForObject(sql, BigDecimal.class, params.toArray());
    return s == null ? BigDecimal.ZERO : s;
  }

  @Override
  public UUID titulaireDe(UUID adherentId, UUID beneficiaireId) {
    if (adherentId != null) {
      return adherentId;
    }
    if (beneficiaireId == null) {
      return null;
    }
    return jdbc
        .query(
            "SELECT adherent_id FROM beneficiaires WHERE id = ?",
            (rs, n) -> uuid(rs, "adherent_id"),
            beneficiaireId)
        .stream()
        .findFirst()
        .orElse(null);
  }

  @Override
  public boolean produitAPlafondFamille(UUID produitId) {
    final Boolean b =
        jdbc.queryForObject(
            """
            SELECT EXISTS (SELECT 1 FROM garanties
                            WHERE produit_id = ? AND deleted_at IS NULL
                              AND plafond_annuel_famille IS NOT NULL)
            """,
            Boolean.class,
            produitId);
    return Boolean.TRUE.equals(b);
  }

  private static final String SQL_GARANTIE =
      """
      SELECT id, produit_id, categorie_acte, taux_couverture, plafond_par_acte,
             plafond_annuel_personne, plafond_annuel_famille, franchise,
             ticket_moderateur, delai_carence_jours, reseau_soins
      FROM garanties
      """;

  private static final RowMapper<GarantieApplicable> MAPPER_GARANTIE =
      (rs, n) -> new GarantieApplicable(
          uuid(rs, "id"),
          uuid(rs, "produit_id"),
          rs.getString("categorie_acte"),
          rs.getBigDecimal("taux_couverture"),
          rs.getBigDecimal("plafond_par_acte"),
          rs.getBigDecimal("plafond_annuel_personne"),
          rs.getBigDecimal("plafond_annuel_famille"),
          rs.getBigDecimal("franchise"),
          rs.getBigDecimal("ticket_moderateur"),
          (Integer) rs.getObject("delai_carence_jours"),
          rs.getString("reseau_soins"));

  @Override
  public Optional<GarantieApplicable> chargerGarantie(UUID garantieId) {
    return jdbc
        .query(SQL_GARANTIE + " WHERE id = ? AND deleted_at IS NULL", MAPPER_GARANTIE, garantieId)
        .stream()
        .findFirst();
  }

  @Override
  public List<GarantieApplicable> garantiesAvecPlafondAnnuel(UUID produitId) {
    return jdbc.query(
        SQL_GARANTIE
            + """
             WHERE produit_id = ? AND deleted_at IS NULL
               AND (plafond_annuel_personne IS NOT NULL OR plafond_annuel_famille IS NOT NULL)
             ORDER BY categorie_acte
            """,
        MAPPER_GARANTIE,
        produitId);
  }

  @Override
  public List<UUID> beneficiairesDe(UUID titulaireId) {
    return jdbc.query(
        "SELECT id FROM beneficiaires WHERE adherent_id = ? AND deleted_at IS NULL ORDER BY id",
        (rs, n) -> uuid(rs, "id"),
        titulaireId);
  }

  @Override
  public Optional<PoliceApplicable> chargerPolice(UUID policeId) {
    return jdbc
        .query(
            """
            SELECT p.id, p.organisation_id, p.produit_id, p.statut, p.date_debut, p.date_fin,
                   pr.periode_cumul_plafond, pr.delai_declaration_jours
            FROM polices p
            JOIN produits pr ON pr.id = p.produit_id
            WHERE p.id = ? AND p.deleted_at IS NULL
            """,
            (rs, n) -> new PoliceApplicable(
                uuid(rs, "id"),
                uuid(rs, "organisation_id"),
                uuid(rs, "produit_id"),
                rs.getString("statut"),
                localDate(rs, "date_debut"),
                localDate(rs, "date_fin"),
                rs.getString("periode_cumul_plafond"),
                (Integer) rs.getObject("delai_declaration_jours")),
            policeId)
        .stream()
        .findFirst();
  }

  @Override
  public BigDecimal tarifConvention(UUID etablissementId, String codeActe, LocalDate date) {
    if (etablissementId == null || codeActe == null || codeActe.isBlank()) {
      return null;
    }
    // Même lien que SQL_CONTEXTE : code d'acte → referentiel_actes → tarif de
    // l'établissement valable à la date.
    return jdbc
        .query(
            """
            SELECT tc.tarif_convention
            FROM referentiel_actes ra
            JOIN tarifs_conventionnes tc
              ON tc.referentiel_acte_id = ra.id
             AND tc.etablissement_id = ?
             AND tc.deleted_at IS NULL
             AND tc.date_debut <= ?
             AND (tc.date_fin IS NULL OR tc.date_fin >= ?)
            WHERE ra.code = ? AND ra.deleted_at IS NULL
            LIMIT 1
            """,
            (rs, n) -> rs.getBigDecimal("tarif_convention"),
            etablissementId,
            date,
            date,
            codeActe)
        .stream()
        .findFirst()
        .orElse(null);
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
