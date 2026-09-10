package ci.assurance.adjudication.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Vérification d'un JWT de service signé HMAC-SHA256 avec un SECRET PARTAGÉ
 * ({@code SERVICE_JWT_SECRET}, variable d'environnement — jamais en dur).
 *
 * Implémentation volontairement minimale (JDK crypto + Jackson, aucune dépendance
 * JWT tierce) :
 * <ul>
 *   <li>en-tête : {@code alg} DOIT être {@code HS256} (rejet de {@code none} / RS256 —
 *       défense contre l'« algorithm confusion ») ;</li>
 *   <li>signature : HMAC-SHA256 sur {@code header.payload}, comparaison à temps
 *       constant ({@link MessageDigest#isEqual}) ;</li>
 *   <li>{@code exp} : présent et dans le futur.</li>
 * </ul>
 */
@Component
public class ServiceJwtVerifier {

  private final byte[] secret;
  private final ObjectMapper mapper = new ObjectMapper();

  public ServiceJwtVerifier(@Value("${service.jwt.secret:}") String secret) {
    if (secret == null || secret.isBlank()) {
      throw new IllegalStateException(
          "SERVICE_JWT_SECRET non défini — le microservice refuse de démarrer sans secret de service.");
    }
    this.secret = secret.getBytes(StandardCharsets.UTF_8);
  }

  public boolean estValide(String token) {
    if (token == null || token.isBlank()) {
      return false;
    }
    try {
      final String[] parts = token.split("\\.");
      if (parts.length != 3) {
        return false;
      }

      final JsonNode header = mapper.readTree(decode(parts[0]));
      if (!"HS256".equals(header.path("alg").asText())) {
        return false;
      }

      final Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      final byte[] attendu =
          mac.doFinal((parts[0] + "." + parts[1]).getBytes(StandardCharsets.UTF_8));
      final byte[] fournie = decode(parts[2]);
      if (!MessageDigest.isEqual(attendu, fournie)) {
        return false;
      }

      final JsonNode payload = mapper.readTree(decode(parts[1]));
      final long exp = payload.path("exp").asLong(0L);
      return exp > 0L && Instant.now().getEpochSecond() < exp;
    } catch (Exception e) {
      return false;
    }
  }

  private static byte[] decode(String base64Url) {
    return Base64.getUrlDecoder().decode(base64Url);
  }
}
