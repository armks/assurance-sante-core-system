# adjudication-service

Microservice **Spring Boot 3 / Java 21 / Maven** — moteur d'adjudication et de calcul
de remboursement (v12). Projet **distinct** de `apps/api` (NestJS), dans le même dépôt.

Il est **propriétaire de la transaction complète d'adjudication** : lecture verrouillée
du plafond, pipeline de règles en `BigDecimal`, écriture du remboursement + du statut,
journalisation via `log_audit()`.

> ⚠️ Ce service n'est **pas encore branché** à `apps/api` (Edge Function de déclenchement
> à venir). Il se teste ici de façon autonome (tests JUnit + `curl` manuel).

---

## Variables d'environnement (toutes obligatoires, aucune valeur en dur)

| Variable | Rôle |
|---|---|
| `JDBC_URL` | URL JDBC Postgres, ex. `jdbc:postgresql://db.xxx.supabase.co:5432/postgres?sslmode=require` |
| `JDBC_USER` | **`svc_adjudication`** (rôle Postgres à grants restreints — jamais `postgres`) |
| `JDBC_PASSWORD` | mot de passe du rôle `svc_adjudication` |
| `SERVICE_JWT_SECRET` | secret partagé HMAC-SHA256 pour valider le JWT de service (identique côté Edge Function) |
| `PORT` | port HTTP (défaut `8081`) |

Le service **refuse de démarrer** si `SERVICE_JWT_SECRET` est absent.

---

## Contrat d'API

```
POST /api/v1/adjudication/{reclamationId}/evaluer
Authorization: Bearer <jwt-service-HS256>

200 OK
{
  "decision": "AUTO_ADJUDIQUE" | "REVUE_MANUELLE" | "REJETE",
  "montant_rembourse": 18400.00,
  "codes_rejet": [],
  "plafond_restant_apres": 81600.00,
  "duree_traitement_ms": 12
}

401  → JWT manquant / invalide / expiré / mauvais algo
404  → réclamation introuvable
409  → réclamation pas au statut EN_ADJUDICATION, ou doublon (remboursement déjà présent)
```

`GET /healthz` → `{"status":"UP"}` (non authentifié).

---

## Pipeline (`AdjudicationService.evaluer`, `@Transactional` — une seule transaction)

1. `SELECT` réclamation + garantie applicable + police (une requête, colonnes autorisées).
2. Idempotence : statut doit être `EN_ADJUDICATION` (409 sinon) ; pas de remboursement existant (409).
3. `SELECT id FROM polices WHERE id = ? FOR UPDATE` (verrou pessimiste) puis
   `SUM(montant_rembourse)` des remboursements de l'année civile pour l'adhérent.
4. Calcul (`Adjudicateur`, `BigDecimal` partout, `HALF_UP`, échelle 2) :
   franchise → taux → plafond par acte → plafond annuel restant.
5. `INSERT INTO remboursements (...) RETURNING id` + `UPDATE reclamations SET statut = ? WHERE id = ? AND statut = 'EN_ADJUDICATION'`.
6. `SELECT log_audit('ADJUDICATION_<decision>', 'reclamations', <id>, <svc-uuid>, <details jsonb>)`.

Toute exception ⇒ **ROLLBACK complet** (rien de partiel n'est écrit).

### Codes

| Code | Sens | Décision typique |
|---|---|---|
| `E001` | police non active à la date de soin | `REJETE` |
| `E006` | plafond annuel atteint / dépassé | `REJETE` (épuisé) ou `REVUE_MANUELLE` (réduit) |
| `E010` | montant remboursé > seuil (150 000) | `REVUE_MANUELLE` |

---

## Build & tests

```bash
# à la racine adjudication-service/  (nécessite JDK 21 + Maven 3.9+)
mvn test          # tests JUnit — AUCUNE base de données requise (repo mocké, calcul pur)
mvn clean package # produit target/adjudication-service-0.1.0.jar
```

Tests :
- `AdjudicateurTest` — cas normal, plafond partiel, plafond épuisé, police inactive,
  hors période, montant élevé — chaque assertion sur un `BigDecimal` **exact** (valeur + échelle).
- `AdjudicationServiceTest` — orchestration : introuvable (404), mauvais statut (409),
  **doublon (409)**, cas normal complet (écritures + audit), police inactive, course sur le statut.
- `ServiceJwtVerifierTest` — signature OK / falsifiée / mauvais secret / expiré / `alg=none` / malformé.

---

## Docker

```bash
docker build -t adjudication-service:0.1.0 .
docker run --rm -p 8081:8081 \
  -e JDBC_URL='jdbc:postgresql://<host>:5432/postgres?sslmode=require' \
  -e JDBC_USER='svc_adjudication' \
  -e JDBC_PASSWORD='<motdepasse>' \
  -e SERVICE_JWT_SECRET='<secret-partage>' \
  adjudication-service:0.1.0
```

Image finale : `eclipse-temurin:21-jre-alpine`, utilisateur non-root, `HEALTHCHECK` sur `/healthz`.

---

## Appel `curl` manuel (test autonome)

### 1. Forger un JWT de service (HS256, HMAC du `SERVICE_JWT_SECRET`)

```bash
SECRET='dev-secret-change-me'
TOKEN=$(node -e '
  const c=require("crypto"), s=process.env.SECRET;
  const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const now=Math.floor(Date.now()/1000);
  const h=b({alg:"HS256",typ:"JWT"});
  const p=b({iss:"edge-declencher-adjudication",aud:"adjudication-service",iat:now,exp:now+300});
  process.stdout.write(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"));
' )
```

Exemple de jeton (secret `dev-secret-change-me`, expiré — pour illustration du format) :

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlZGdlLWRlY2xlbmNoZXItYWRqdWRpY2F0aW9uIiwiYXVkIjoiYWRqdWRpY2F0aW9uLXNlcnZpY2UiLCJpYXQiOjE3ODkwNDcwMjIsImV4cCI6MTc4OTA0NzMyMn0.GeE5J1luEPJI4vdvvNYil2-9o4FR-J5mfX2Jx4Nh81A
```

### 2. Appeler l'endpoint

```bash
# sans jeton → 401
curl -i -X POST http://localhost:8081/api/v1/adjudication/11111111-1111-4111-8111-111111111111/evaluer

# avec jeton → 200 + décision
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8081/api/v1/adjudication/<reclamationId>/evaluer | jq
```

Réponse attendue (réclamation `EN_ADJUDICATION`, garantie taux 80 % / franchise 2000 /
plafond annuel 100 000, rien de consommé, montant réclamé 25 000) :

```json
{
  "decision": "AUTO_ADJUDIQUE",
  "montant_rembourse": 18400.00,
  "codes_rejet": [],
  "plafond_restant_apres": 81600.00,
  "duree_traitement_ms": 9
}
```

Un second appel sur la même réclamation → **409** (`statut` n'est plus `EN_ADJUDICATION`,
ou un remboursement existe déjà).

---

## Déploiement (piste simple, solo)

Fly.io / Railway : conteneur ci-dessus + secrets `JDBC_*` / `SERVICE_JWT_SECRET`.
Connexion vers la base Supabase en `sslmode=require`. Le service n'est **jamais** exposé
publiquement — seule l'Edge Function `declencher-adjudication` l'appelle (réseau privé /
IP allow-list).
