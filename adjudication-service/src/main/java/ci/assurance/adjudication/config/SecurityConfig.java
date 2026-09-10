package ci.assurance.adjudication.config;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * {@code /api/v1/adjudication/**} exige un JWT de service valide (sinon 401).
 * Tout le reste ({@code /healthz}) est ouvert. Stateless, pas de CSRF, pas de
 * session : c'est une API machine-à-machine.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

  private final ServiceJwtVerifier verifier;

  public SecurityConfig(ServiceJwtVerifier verifier) {
    this.verifier = verifier;
  }

  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    ServiceJwtAuthFilter jwtFilter = new ServiceJwtAuthFilter(verifier);

    http.csrf(csrf -> csrf.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            auth ->
                auth.requestMatchers("/api/v1/adjudication/**")
                    .authenticated()
                    .anyRequest()
                    .permitAll())
        .exceptionHandling(
            e ->
                e.authenticationEntryPoint(
                    (request, response, ex) ->
                        response.sendError(
                            HttpServletResponse.SC_UNAUTHORIZED,
                            "JWT de service manquant ou invalide")))
        .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);

    return http.build();
  }
}
