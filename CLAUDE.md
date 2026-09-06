# CLAUDE.md

Ce projet utilise le skill `assurance-sante-core-system` (voir .claude/skills/) —
consulte-le systématiquement avant toute tâche liée au schéma, aux rôles, au RBAC,
au NestJS, à Supabase, ou au microservice Java d'adjudication. Architecture confirmée :
Next.js 16 + NestJS + Supabase (Auth via JWKS, pas de secret partagé) + microservice
Java isolé pour l'adjudication uniquement. Ne réinvente jamais une règle déjà spécifiée
dans ce skill.

## Suivi de progression
Après chaque tâche significative terminée, mets à jour PROGRESSION.md à la racine :
entrée datée, étape réalisée, ce qui a été créé, statut. Ajoute seulement, ne réécris
jamais l'historique.

## Contrôle de version
Après chaque prompt validé par l'utilisateur, propose un commit git avec un message
clair référençant le numéro du prompt, puis un push vers origin si l'utilisateur confirme.