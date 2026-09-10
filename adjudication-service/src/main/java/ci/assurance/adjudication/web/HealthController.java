package ci.assurance.adjudication.web;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Sonde de vivacité — non authentifiée (utilisée par le HEALTHCHECK du conteneur). */
@RestController
public class HealthController {

  @GetMapping("/healthz")
  public Map<String, String> health() {
    return Map.of("status", "UP", "service", "adjudication-service");
  }
}
