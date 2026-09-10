package ci.assurance.adjudication;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ci.assurance.adjudication.config.ServiceJwtVerifier;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Vérifie la validation HMAC-SHA256 du JWT de service (secret partagé). */
class ServiceJwtVerifierTest {

  private static final String SECRET = "secret-de-service-partage-pour-les-tests-0123456789";
  private final ServiceJwtVerifier verifier = new ServiceJwtVerifier(SECRET);

  @Test
  @DisplayName("Jeton HS256 bien signé et non expiré → valide")
  void jetonValide() {
    String token = forger("HS256", SECRET, Instant.now().plusSeconds(60).getEpochSecond());
    assertThat(verifier.estValide(token)).isTrue();
  }

  @Test
  @DisplayName("Signature falsifiée → invalide")
  void signatureFalsifiee() {
    String bon = forger("HS256", SECRET, Instant.now().plusSeconds(60).getEpochSecond());
    String falsifie = bon.substring(0, bon.length() - 2) + "xy";
    assertThat(verifier.estValide(falsifie)).isFalse();
  }

  @Test
  @DisplayName("Signé avec un autre secret → invalide")
  void mauvaisSecret() {
    String token =
        forger("HS256", "un-autre-secret-completement-different", Instant.now().plusSeconds(60).getEpochSecond());
    assertThat(verifier.estValide(token)).isFalse();
  }

  @Test
  @DisplayName("Jeton expiré → invalide")
  void jetonExpire() {
    String token = forger("HS256", SECRET, Instant.now().minusSeconds(10).getEpochSecond());
    assertThat(verifier.estValide(token)).isFalse();
  }

  @Test
  @DisplayName("alg=none (attaque de confusion d'algorithme) → invalide")
  void algNone() {
    String header = b64("{\"alg\":\"none\",\"typ\":\"JWT\"}");
    String payload = b64("{\"exp\":" + Instant.now().plusSeconds(60).getEpochSecond() + "}");
    assertThat(verifier.estValide(header + "." + payload + ".")).isFalse();
  }

  @Test
  @DisplayName("Jeton vide / malformé → invalide")
  void malforme() {
    assertThat(verifier.estValide(null)).isFalse();
    assertThat(verifier.estValide("")).isFalse();
    assertThat(verifier.estValide("a.b")).isFalse();
  }

  @Test
  @DisplayName("Secret absent → le composant refuse d'être construit")
  void secretAbsent() {
    assertThatThrownBy(() -> new ServiceJwtVerifier("  "))
        .isInstanceOf(IllegalStateException.class);
  }

  // --- forge un JWT HS256 avec le même algo que la prod ---
  private static String forger(String alg, String secret, long exp) {
    String header = b64("{\"alg\":\"" + alg + "\",\"typ\":\"JWT\"}");
    String payload = b64("{\"iss\":\"edge-fn\",\"aud\":\"adjudication\",\"exp\":" + exp + "}");
    String signingInput = header + "." + payload;
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] sig = mac.doFinal(signingInput.getBytes(StandardCharsets.UTF_8));
      return signingInput + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(sig);
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  private static String b64(String json) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
  }
}
