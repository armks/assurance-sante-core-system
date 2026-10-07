package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ci.assurance.adjudication.web.HealthController;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

class HealthControllerTest {

  @Test
  @DisplayName("/readyz : base joignable → 200, status UP, database UP")
  void pret() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(eq("SELECT 1"), eq(Integer.class))).thenReturn(1);

    var r = new HealthController(jdbc).ready();

    assertThat(r.getStatusCode().value()).isEqualTo(200);
    assertThat(r.getBody()).containsEntry("status", "UP").containsEntry("database", "UP");
  }

  @Test
  @DisplayName("/readyz : base injoignable → 503, status DOWN, détail sans secret (type d'erreur seulement)")
  void baseIndisponible() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(eq("SELECT 1"), eq(Integer.class)))
        .thenThrow(new DataAccessResourceFailureException("jdbc:postgresql://secret-host:5432 password=xyz"));

    var r = new HealthController(jdbc).ready();

    assertThat(r.getStatusCode().value()).isEqualTo(503);
    assertThat(r.getBody())
        .containsEntry("status", "DOWN")
        .containsEntry("database", "DOWN")
        .containsEntry("detail", "DataAccessResourceFailureException");
    assertThat(r.getBody().toString()).doesNotContain("secret-host").doesNotContain("password");
  }

  @Test
  @DisplayName("/healthz : vivacité, indépendante de la base")
  void vivacite() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    assertThat(new HealthController(jdbc).health()).containsEntry("status", "UP");
  }
}
