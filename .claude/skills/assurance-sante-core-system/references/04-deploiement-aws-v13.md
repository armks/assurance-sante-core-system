---
name: saas-assurance-sante-afrique
version: 13.0
description: >
  Extension v13 — plan de déploiement AWS pour l'architecture hybride retenue en v12
  (Next.js + Supabase Cloud + microservice Java d'adjudication). Ne déplace pas Supabase
  vers AWS — seuls le frontend et le microservice Java sont déployés sur AWS.
---

# Extension v13 — Déploiement AWS

## 1. Ce qui va sur AWS, et ce qui n'y va pas

| Composant | Hébergement | Pourquoi |
|---|---|---|
| Next.js (frontend + dashboards) | **AWS Amplify Hosting** | Support natif Next.js (SSR jusqu'à la v15), CI/CD par simple push Git, gère automatiquement CloudFront + Lambda |
| Microservice Java d'adjudication | **AWS ECS Fargate** | Containers déjà prêts (Dockerfile du Prompt 22d), pas de "cold start" contrairement à une fonction serverless — important pour un service financier appelé en continu |
| Postgres/Auth/Storage/Realtime | **Supabase Cloud (inchangé)** | Auto-héberger Supabase sur AWS soi-même est une charge d'exploitation disproportionnée à ce stade — aucun gain réel pour vous actuellement |
| Secrets (clés JDBC, JWT de service) | **AWS Secrets Manager** | Jamais en dur dans le code ni dans les variables d'environnement en clair |

⚠️ Point de vigilance technique sur Amplify (vérifié à ce jour) : le support Next.js va
jusqu'à la version 15, avec certaines limites — pas de middleware Edge complet (seulement
les routes API Edge), une taille de build SSR plafonnée (~220 Mo), et une taille de réponse
HTTP SSR plafonnée (~5,7 Mo). Pour votre projet (dashboards, formulaires, PDF générés côté
Edge Function Supabase plutôt que côté Next.js), ces limites ne devraient pas vous
concerner — mais vérifiez la version exacte de Next.js supportée sur la documentation
Amplify au moment de déployer, ces limites évoluent.

---

## 2. Étape 1 — Déployer le frontend Next.js sur AWS Amplify

1. Connectez-vous à la console AWS, allez dans **Amplify Hosting**.
2. **Host web app** → connectez votre dépôt GitHub (celui qu'on a initialisé plus tôt).
3. Amplify détecte automatiquement Next.js et propose une configuration de build par défaut
   — vérifiez qu'elle inclut les variables d'environnement suivantes (section
   **Environment variables**) :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ADJUDICATION_SERVICE_URL` (l'URL du microservice Java, définie à l'étape 3)
4. Lancez le déploiement. Amplify recompile automatiquement à chaque `git push` sur `main`.
5. Configurez un domaine personnalisé si vous en avez un (**Domain management**).

---

## 3. Étape 2 — Déployer le microservice Java sur ECS Fargate

### 3.1 Créer le dépôt d'images (ECR)
```bash
aws ecr create-repository --repository-name adjudication-service
```

### 3.2 Construire et pousser l'image (utilise le Dockerfile du Prompt 22d)
```bash
docker build -t adjudication-service ./adjudication-service
docker tag adjudication-service:latest <compte>.dkr.ecr.<region>.amazonaws.com/adjudication-service:latest
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <compte>.dkr.ecr.<region>.amazonaws.com
docker push <compte>.dkr.ecr.<region>.amazonaws.com/adjudication-service:latest
```

### 3.3 Créer le cluster et le service ECS Fargate
- Créez un cluster ECS (mode Fargate, pas EC2 — pas de serveur à gérer).
- Créez une **Task Definition** référençant l'image ECR, avec les variables d'environnement
  (`JDBC_URL`, `JDBC_USER`, `JDBC_PASSWORD`, `SERVICE_JWT_SECRET`) injectées **depuis AWS
  Secrets Manager**, jamais en clair dans la Task Definition.
- Créez le **Service** ECS avec au minimum 1 tâche active (2 en production pour la haute
  disponibilité), derrière un **Application Load Balancer** interne.

### 3.4 Pourquoi Fargate plutôt qu'une alternative serverless
Évitez AWS App Runner pour un nouveau projet à ce stade — son support est en phase de
retrait. Fargate reste le bon choix : pas de gestion de serveur, mais un conteneur toujours
actif (pas de délai de démarrage à froid), ce qui compte pour un service qui traite de
l'argent en continu.

---

### 3.5 Health checks (ajout du 2026-10-07)

Depuis ADR-005, le microservice est **indispensable** : sans lui, aucune facture tiers payant,
aucune dispensation en pharmacie et aucune adjudication de réclamation (l'API répond 503 avec
un message en français). Trois niveaux de contrôle, chacun avec son rôle :

| Niveau | Où | Sonde | Effet si elle échoue |
|---|---|---|---|
| Vivacité du conteneur | Task Definition ECS, `healthCheck` | `GET /healthz` (ne dépend **pas** de la base) | ECS remplace la tâche |
| Disponibilité de la tâche | Target group de l'ALB interne | `GET /readyz` → 200 (joint Postgres en `svc_adjudication`), 503 sinon | l'ALB retire la tâche de la rotation, sans la tuer |
| Supervision de bout en bout | Moniteur externe (Route 53 health check, CloudWatch Synthetics…) | `GET /api/v1/sante` de l'API NestJS → 200 `UP`, 503 `DEGRADE` — toutes les 60 s, délai 5 s | alerte à l'équipe (SNS / e-mail) après 2 échecs consécutifs |

- **Pourquoi deux sondes côté Java.** Une coupure de la base ne doit pas faire redémarrer les
  conteneurs en boucle (ils n'y peuvent rien) : la vivacité (`/healthz`) ne teste que le
  processus, la disponibilité (`/readyz`) teste aussi la base.
- **Task Definition** : modèle versionné dans `adjudication-service/deploy/ecs-task-definition.json`
  (`healthCheck` = `wget -qO- http://localhost:8081/healthz`, intervalle 30 s, 3 essais,
  `startPeriod` 60 s pour laisser démarrer la JVM ; secrets lus dans Secrets Manager).
  Le `HEALTHCHECK` du Dockerfile n'est **pas** utilisé par ECS : c'est ce `healthCheck` qui compte.
- **Target group** : protocole HTTP, chemin `/readyz`, codes de succès `200`, intervalle 15 s,
  timeout 5 s, seuils sain 2 / non sain 2.
- **Alarme CloudWatch** sur la métrique `UnHealthyHostCount` du target group (> 0 pendant
  2 minutes) **et** sur le moniteur externe de `/api/v1/sante` — c'est ce dernier qui prévient
  avant les utilisateurs, car il vérifie aussi que l'API joint bien le microservice (réseau,
  security groups, `ADJUDICATION_SERVICE_URL`).
- **Moniteur externe de `/api/v1/sante`** (ajout du 2026-10-07) — c'est la seule sonde qui
  voit la chaîne complète (API, sa base, réseau jusqu'au microservice, base du microservice) :
  - requête : `GET https://<api>/api/v1/sante`, **sans authentification** ;
  - **intervalle 60 s**, **délai de réponse 5 s** (la sonde de l'API attend le microservice
    3 s au plus, `ADJUDICATION_SANTE_TIMEOUT_MS` : la réponse arrive donc avant le délai même
    quand le microservice ne répond plus) ;
  - **succès** : HTTP **200** avec `"statut": "UP"` ;
  - **échec** : HTTP **503** avec `"statut": "DEGRADE"` — le corps dit quel composant est en
    cause : `api.baseDeDonnees` (`UP` / `DOWN`), `adjudication.statut` (`UP` / `DOWN` =
    répond mais sa base est injoignable / `INJOIGNABLE`) et `adjudication.detail` (type
    d'erreur seulement, jamais d'URL ni de secret) ; ou toute absence de réponse dans les 5 s
    (API elle-même arrêtée) ;
  - **alerte après 2 échecs consécutifs** (≈ 2 minutes), et notification de retour à la normale
    au premier succès — un échec isolé (redémarrage, déploiement) ne réveille personne.
  - Effet pour les utilisateurs pendant un `DEGRADE` dû au microservice : facturation tiers
    payant et préparation de dispensation refusées en **503** avec un message en français
    (« Le calcul de la prise en charge par l'assurance est momentanément indisponible : la
    facture n'a pas été émise / la dispensation n'a pas été préparée. Réessayez dans quelques
    minutes. »), aucune donnée créée.
- Côté API, le délai de la sonde est réglable (`ADJUDICATION_SANTE_TIMEOUT_MS`, 3 s par défaut).
  L'état est aussi affiché au superadmin (écran « Santé système »).
- Les sondes sont non authentifiées et n'exposent aucune donnée métier ni secret (seulement le
  type d'erreur) ; les routes `/api/v1/adjudication/**` restent protégées par le JWT de service.

### 3.6 Test d'intégration OBLIGATOIRE avant chaque déploiement (ajout du 2026-10-07)

Les tests unitaires (`npm test`, JUnit) ne peuvent pas prouver qu'un verrou de base de
données protège réellement les plafonds annuels contre deux factures simultanées. Un test
d'intégration le fait, contre la plateforme réelle :

```bash
# API et microservice démarrés sur l'environnement de PRÉ-PRODUCTION (jamais la production :
# le test crée puis supprime ses données) — GET /api/v1/sante doit répondre 200 « UP »
INTEGRATION_API_URL=https://<api-preprod>/api/v1 npm run test:integration --workspace apps/api
```

- `apps/api/test/integration/factures-paralleles.int-spec.ts` : deux factures tiers payant
  lancées **réellement en parallèle** — plafond par personne (même adhérent), puis plafond
  familial (deux bénéficiaires). Attendu : 20 000 + 10 000 pour un plafond de 30 000 ; si le
  verrou a disparu, le test échoue (20 000 + 20 000).
- Il crée ses données dans une organisation dédiée, les supprime dans l'ordre inverse des
  dépendances et vérifie qu'il ne reste aucune ligne ni compte.
- **Un test rouge bloque le déploiement.** Détails et variables : `apps/api/test/integration/README.md`.

## 4. Étape 3 — Sécuriser la communication entre les composants

```
AWS Amplify (Next.js)                    AWS ECS Fargate (Java)
        │                                        │
        │  Appel via Edge Function Supabase       │
        │  (déclencheur d'adjudication, v12)      │
        ▼                                        ▼
   Supabase Cloud (Postgres/Auth) ◄── connexion JDBC directe (svc_adjudication)
```

- Le microservice Java n'est **jamais exposé publiquement** sur Internet — configurez le
  security group ECS pour n'accepter des connexions que depuis l'adresse IP sortante de vos
  Edge Functions Supabase (à whitelister explicitement), pas depuis `0.0.0.0/0`.
- La connexion JDBC du microservice vers Postgres Supabase doit utiliser SSL (`sslmode=require`
  dans la chaîne de connexion).
- Toutes les valeurs sensibles (`JDBC_PASSWORD`, `SERVICE_JWT_SECRET`) vivent uniquement dans
  **AWS Secrets Manager**, référencées par la Task Definition ECS — jamais commitées, même
  dans un `.env` local.

---

## 5. Étape 4 — Observabilité minimale dès le départ

- Activez **CloudWatch Logs** sur le service ECS (logs du microservice Java) et sur Amplify
  (logs du frontend) — activé par défaut sur les deux, vérifiez juste qu'ils sont bien
  consultables.
- Configurez une alerte **AWS Budgets** dès le premier jour, avant même le premier vrai
  utilisateur — un service mal configuré (boucle infinie, tâche ECS qui redémarre en boucle)
  peut générer une facture surprise si personne ne surveille.

---

## 6. Ordre d'exécution recommandé

1. Terminez d'abord tous les prompts du Palier 1 (v11) **en local** — ne déployez rien avant
   d'avoir un MVP qui fonctionne sur votre machine.
2. Déployez le frontend sur Amplify (§2) — le plus simple, à faire en premier.
3. Déployez le microservice Java sur ECS Fargate (§3) — une fois les tests JUnit du
   Prompt 22c tous verts **et le test d'intégration `npm run test:integration` vert sur la
   pré-production (§3.6)** — à refaire avant CHAQUE déploiement ultérieur.
4. Sécurisez les échanges (§4) avant d'inviter le moindre vrai utilisateur.
5. Mettez en place le budget et les logs (§5) — dernière étape avant ouverture réelle.

## 7. Limite honnête à signaler

Les détails précis (limites exactes d'Amplify, tarifs Fargate, disponibilité régionale)
changent régulièrement chez AWS. Avant de vous engager sur les coûts ou de finaliser la
configuration, vérifiez la documentation AWS à jour (docs.aws.amazon.com/amplify et
docs.aws.amazon.com/ecs) plutôt que de vous fier uniquement à ce document — ce plan vous
donne l'architecture et l'ordre des étapes, pas les tarifs actuels.
