package ci.assurance.adjudication.web;

import ci.assurance.adjudication.domain.AdjudicationExceptions.DemandeInvalide;
import ci.assurance.adjudication.domain.AdjudicationExceptions.Doublon;
import ci.assurance.adjudication.domain.AdjudicationExceptions.MauvaisStatut;
import ci.assurance.adjudication.domain.AdjudicationExceptions.ReclamationIntrouvable;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

  @ExceptionHandler(ReclamationIntrouvable.class)
  public ResponseEntity<Map<String, Object>> introuvable(ReclamationIntrouvable e) {
    return corps(HttpStatus.NOT_FOUND, e.getMessage());
  }

  @ExceptionHandler(DemandeInvalide.class)
  public ResponseEntity<Map<String, Object>> invalide(DemandeInvalide e) {
    return corps(HttpStatus.BAD_REQUEST, e.getMessage());
  }

  @ExceptionHandler({MauvaisStatut.class, Doublon.class})
  public ResponseEntity<Map<String, Object>> conflit(RuntimeException e) {
    return corps(HttpStatus.CONFLICT, e.getMessage());
  }

  private static ResponseEntity<Map<String, Object>> corps(HttpStatus statut, String message) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("timestamp", Instant.now().toString());
    body.put("status", statut.value());
    body.put("error", statut.getReasonPhrase());
    body.put("message", message);
    return ResponseEntity.status(statut).body(body);
  }
}
