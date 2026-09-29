# CLAUDE.md

Ce projet utilise le skill `assurance-sante-core-system` (voir .claude/skills/) —
consulte-le systématiquement avant toute tâche liée au schéma, aux rôles, au RBAC,
au NestJS, à Supabase, ou au microservice Java d'adjudication. Architecture confirmée :
Next.js 16 + NestJS + Supabase (Auth via JWKS, pas de secret partagé) + microservice
Java isolé pour l'adjudication uniquement. Ne réinvente jamais une règle déjà spécifiée
dans ce skill.

Pour toute construction ou modification d'écran du frontend Next.js (`apps/web`), le skill
`health-insurance-core-ui` s'applique : réutilise les composants `components/dashboard/patterns/`
(DataTable, StatutBadge, FormulaireModal, Champ*, CarteResume, GrilleCartes) et le découpage
`page.tsx` (server) / `*-ecran.tsx` (client) / `actions.ts` (server actions).

## Suivi de progression
Après chaque tâche significative terminée, mets à jour PROGRESSION.md à la racine :
entrée datée, étape réalisée, ce qui a été créé, statut. Ajoute seulement, ne réécris
jamais l'historique.

## Contrôle de version
Après chaque prompt validé par l'utilisateur, propose un commit git avec un message
clair référençant le numéro du prompt, puis un push vers origin si l'utilisateur confirme.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
