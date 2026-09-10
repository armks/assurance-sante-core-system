package ci.assurance.adjudication.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * N'agit QUE sur {@code /api/v1/adjudication/**}. Si un {@code Authorization:
 * Bearer <jwt>} valide est présent, la requête est authentifiée ; sinon elle
 * reste anonyme et sera rejetée en 401 par la chaîne de sécurité.
 *
 * <p>Instancié par {@link SecurityConfig} (pas de {@code @Component} — on évite
 * l'auto-enregistrement dans la chaîne de servlets par défaut).
 */
public class ServiceJwtAuthFilter extends OncePerRequestFilter {

  private static final String PREFIXE_PROTEGE = "/api/v1/adjudication";

  private final ServiceJwtVerifier verifier;

  public ServiceJwtAuthFilter(ServiceJwtVerifier verifier) {
    this.verifier = verifier;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getRequestURI().startsWith(PREFIXE_PROTEGE);
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {

    final String header = request.getHeader("Authorization");
    if (header != null && header.startsWith("Bearer ")) {
      final String token = header.substring("Bearer ".length()).trim();
      if (verifier.estValide(token)) {
        var authentication =
            new UsernamePasswordAuthenticationToken(
                "service-adjudication",
                null,
                List.of(new SimpleGrantedAuthority("ROLE_SERVICE")));
        authentication.setDetails(request.getRemoteAddr());
        SecurityContextHolder.getContext().setAuthentication(authentication);
      }
    }
    chain.doFilter(request, response);
  }
}
