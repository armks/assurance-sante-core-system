---
name: assurance-sante-core-system
version: 18.0-NESTJS-SUPABASE
description: >
  Évalue et recommande une troisième voie : Next.js + NestJS (organisé en modules selon la
  philosophie Modulith de v16, mais en TypeScript) + Supabase (Auth, Postgres, Storage,
  RLS conservés). Meilleur compromis identifié pour lancement rapide en solo avec montée
  en compétence progressive vers une architecture extractible en microservices.
---

# Architecture v18 — Next.js + NestJS + Supabase

## 1. Réponse directe : oui, et c'est recommandé

```
Next.js (frontend, dashboards)
        │ REST/tRPC
        ▼
NestJS (application unique au départ, organisée en modules stricts —
même philosophie que v16, en TypeScript)

  identity/ · member/ · plan/ · policy/ · billing/ · provider/
  eligibility/ · preauthorization/ · claims/ · adjudication/
  payment/ · notification/ · reporting/
        │
        ▼
Supabase — Auth (JWT), Postgres (RLS conservée en défense en
profondeur), Storage (documents, cartes, ordonnances)
```

**Ce qui change par rapport à v9-v14** : au lieu que Next.js appelle directement le client
Supabase pour toute la logique métier, **NestJS devient la couche applicative intermédiaire**
qui porte les règles métier (calcul, validation, workflow), pendant que Supabase reste
l'infrastructure (authentification, stockage, base de données).

**Ce qui change par rapport à v15-v16** : plus besoin de Keycloak (Supabase Auth suffit), plus
besoin de gérer vous-même PostgreSQL sur AWS RDS (Supabase le fait), pas de bascule de
langage entre Java et TypeScript.

## 2. Pourquoi c'est un meilleur compromis pour votre situation précise

| Critère | Java/Spring/Keycloak (v15-16) | NestJS + Supabase (v18) |
|---|---|---|
| Un seul langage sur tout le projet | Non (Java backend, TS frontend) | Oui — TypeScript partout |
| Charge opérationnelle (Auth, DB, Storage) | Élevée, tout à gérer vous-même | Faible — Supabase gère l'infra |
| Structure modulaire extractible en microservices plus tard | Oui (Spring Modulith) | Oui — NestJS a le même mécanisme (modules + `@nestjs/microservices` natif pour l'extraction future via Redis/NATS/gRPC) |
| Vitesse pour un premier MVP testable | Lente | Rapide — cohérent avec "lancer l'entreprise" |
| Crédibilité "professionnelle" du code applicatif | Élevée | Élevée aussi — NestJS est un framework d'entreprise reconnu, pas un raccourci |
| Claude Code, aisance sur cette stack | Bonne | Excellente — écosystème JS/TS très bien maîtrisé |

## 3. Les deux réserves honnêtes à connaître avant de trancher

### 3.1 Précision financière — le vrai point technique à ne pas négliger
Java a `BigDecimal` nativement, ce qui rend les calculs financiers (remboursements,
cotisations, plafonds) naturellement sûrs contre les erreurs d'arrondi en virgule flottante.
**JavaScript/TypeScript n'a pas cet équivalent natif** — un nombre comme `0.1 + 0.2` ne donne
pas exactement `0.3` en JS. Ce n'est pas disqualifiant, mais ça exige une **discipline
explicite** :
- Utiliser systématiquement une librairie de décimaux exacts (`decimal.js` ou équivalent) pour
  tout calcul financier dans le module `adjudication`, jamais le type `number` natif.
- Stocker les montants en base comme `numeric`/`decimal` (déjà notre convention SQL), jamais
  en `float`.

**Ma recommandation concrète** : gardez le microservice Java d'Adjudication tel qu'il est déjà
spécifié (v12) — il reste le composant qui manipule l'argent avec le plus de garanties
natives, et il est déjà entièrement écrit dans le plan. Construisez les **13 autres modules**
en NestJS. C'est un choix polyglotte assumé, pas un compromis bancal : le langage le plus
rigoureux (Java) pour le calcul financier critique, le langage le plus rapide à itérer
(TypeScript) pour tout le reste — exactement le principe qu'on avait déjà posé en v12 en
isolant ce service, simplement étendu.

### 3.2 Disponibilité de compétences NestJS vs Java dans un an
Vous prévoyez d'embaucher une équipe dans ~12 mois. Je n'ai pas d'information fiable sur la
composition réelle du marché des développeurs à Abidjan (proportion Java vs Node/TypeScript)
— c'est un point à vérifier vous-même avant de vous engager définitivement, pas quelque chose
que je peux affirmer avec certitude. Ce que je peux dire : TypeScript/Node est globalement en
forte croissance dans l'écosystème des développeurs formés récemment (bootcamps, formations
web), donc le pari n'est pas déraisonnable, mais vérifiez localement.

## 4. Structure NestJS concrète

```typescript
// src/adjudication/adjudication.module.ts — appel au microservice Java existant (v12),
// pas de réécriture de la logique de calcul
@Module({
  imports: [HttpModule],
  providers: [AdjudicationClientService],  // appelle le microservice Java via son API REST
  exports: [AdjudicationClientService],
})
export class AdjudicationModule {}

// src/claims/claims.module.ts — logique métier en NestJS/TypeScript
@Module({
  imports: [MemberModule, PolicyModule, AdjudicationModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
```

Chaque module NestJS suit la même règle que le Modulith Spring (v16 §1) : dépendances
explicites déclarées, pas d'accès direct aux internals d'un autre module — NestJS l'impose
naturellement via son système d'injection de dépendances et l'encapsulation des providers non
exportés.

## 5. Connexion à Supabase depuis NestJS

Deux façons de faire, à combiner selon le besoin :
- **Pour l'authentification** : NestJS valide le JWT émis par Supabase Auth (middleware de
  vérification de signature), récupère le rôle/organisation_id depuis les claims — pas de
  réimplémentation de l'auth.
- **Pour les données** : NestJS se connecte à la base Postgres de Supabase directement via
  TypeORM ou Prisma (connexion SQL standard), plutôt que par le client JS Supabase — ça vous
  donne un vrai contrôle transactionnel (nécessaire pour le verrouillage du plafond, même
  niveau de rigueur que le microservice Java) tout en gardant Supabase comme hébergeur de la
  base.
- **RLS Postgres reste active** en défense en profondeur, même si NestJS applique aussi ses
  propres vérifications d'autorisation au niveau applicatif — la double couche de sécurité
  déjà recommandée en v15 §6 s'applique ici aussi.

## 6. Ce qui ne change pas du tout

- Le dictionnaire des rôles (v9 §3, 24 sous-rôles), la hiérarchie de provisioning (v5, v6),
  la séparation médicale (v10), le système à 4 codes de vérification (v8), les domaines
  complémentaires (v14) — **tout reste identique**, c'est de la spécification fonctionnelle,
  indépendante du langage qui l'implémente.
- Le microservice Java d'Adjudication (v12) — repris tel quel.
- Le déploiement AWS du frontend (Amplify) reste valable ; NestJS se déploie de la même façon
  que le microservice Java l'était (conteneur Docker sur ECS Fargate), donc v13 reste
  largement réutilisable, juste avec un Dockerfile Node au lieu d'un Dockerfile Java pour le
  backend NestJS.

## 7. Recommandation finale

**Oui, adoptez cette architecture** : Next.js + NestJS (modulith, 13 modules TypeScript) +
microservice Java d'Adjudication (inchangé, v12) + Supabase (Auth, Postgres, Storage, RLS).
C'est cohérent avec votre contrainte réelle (lancer vite, seul, équipe dans un an), tout en
restant une architecture professionnelle et extractible en microservices plus tard —
NestJS a exactement le même mécanisme d'extraction progressive que Spring Modulith (v16 §3),
donc la trajectoire de migration future reste tout aussi valable, simplement en restant
majoritairement en TypeScript plutôt qu'en migrant vers Java pour tout.

## 8. Prochaine étape

Je peux maintenant réécrire la séquence de prompts Claude Code (`cursor-prompts-execution-
guide.md`) pour intégrer NestJS comme couche applicative entre Next.js et Supabase, en
gardant la même séquence de Phases (0 à 13, v9) mais avec des prompts adaptés à cette
structure. On y va ?
