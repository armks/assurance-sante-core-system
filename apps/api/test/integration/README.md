# Tests d'intégration (hors suite normale)

Ces tests appellent la **plateforme réelle** — API NestJS, microservice Java
d'adjudication et base Supabase — et écrivent des données. Ils ne font donc pas partie
de `npm test` (qui ne regarde que `src/**/*.spec.ts`).

## À lancer avant chaque déploiement

Obligatoire avant toute mise en production touchant la facturation, l'adjudication ou
les plafonds (voir aussi la doc de déploiement, §3.6).

```bash
# 1. démarrer l'API et le microservice (GET /api/v1/sante doit répondre 200 « UP »)
npm run api:dev                                   # racine du dépôt
# (adjudication-service) set -a; . ./.env; set +a; mvn spring-boot:run

# 2. lancer les tests d'intégration
npm run test:integration --workspace apps/api     # ou, depuis apps/api : npm run test:integration
```

Variables lues : `apps/api/.env` (`DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) et la clé publique Supabase (`SUPABASE_PUBLISHABLE_KEY`,
à défaut `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` de `apps/web/.env.local`).
`INTEGRATION_API_URL` (défaut `http://localhost:3001/api/v1`) permet de viser un autre
environnement — **jamais la production** : le test crée et supprime des données.

Si la plateforme n'est pas prête, le test s'arrête immédiatement avec un message
explicite. Chaque test crée ses données dans une organisation dédiée, les supprime dans
l'ordre inverse des dépendances et vérifie qu'il ne reste aucune ligne ni compte.

## Contenu

| Fichier | Vérifie |
|---|---|
| `factures-paralleles.int-spec.ts` | Deux factures tiers payant **réellement simultanées** ne dépassent jamais ensemble un plafond annuel : plafond par personne (même adhérent), plafond familial (deux bénéficiaires). Échoue si le verrou `pg_advisory_xact_lock` est retiré (vérifié le 2026-10-07 en désactivant le verrou). |
