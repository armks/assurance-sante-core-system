package ci.assurance.adjudication.web;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sondes non authentifiées (aucune donnée métier exposée) :
 *
 * <ul>
 *   <li>{@code /healthz} — vivacité : le processus répond (HEALTHCHECK du conteneur ; ne
 *       dépend PAS de la base, pour ne pas faire redémarrer le conteneur quand c'est la base
 *       qui est indisponible) ;</li>
 *   <li>{@code /readyz} — disponibilité : le service peut réellement adjuger / simuler, donc
 *       joindre Postgres avec le rôle {@code svc_adjudication}. 503 sinon. Utilisée par le
 *       core NestJS ({@code GET /api/v1/sante}, santé système superadmin).</li>
 * </ul>
 */
@RestController
public class HealthController {

  private final JdbcTemplate jdbc;

  public HealthController(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @GetMapping("/healthz")
  public Map<String, String> health() {
    return Map.of("status", "UP", "service", "adjudication-service");
  }

  @GetMapping("/readyz")
  public ResponseEntity<Map<String, Object>> ready() {
    final Map<String, Object> corps = new LinkedHashMap<>();
    corps.put("service", "adjudication-service");
    final long debut = System.nanoTime();
    try {
      jdbc.queryForObject("SELECT 1", Integer.class);
      corps.put("status", "UP");
      corps.put("database", "UP");
      corps.put("database_latence_ms", (System.nanoTime() - debut) / 1_000_000L);
      return ResponseEntity.ok(corps);
    } catch (RuntimeException e) {
      corps.put("status", "DOWN");
      corps.put("database", "DOWN");
      // type d'erreur seulement : jamais l'URL JDBC ni un message pouvant contenir un identifiant
      corps.put("detail", e.getClass().getSimpleName());
      return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(corps);
    }
  }
}
