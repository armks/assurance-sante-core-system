-- ===========================================================================
-- Correctif RLS — `reclamations_lecture` / `remboursements_lecture` n'avaient
-- AUCUNE restriction de rôle (contrairement à `polices_lecture`,
-- `cotisations_lecture`, `grilles_tarifaires_lecture`, qui filtrent toutes par
-- `sr.entite_code = 'ASSUREUR'` via `profils`/`sous_roles`, cf. prisma/sql/004,
-- 005, 006). Découvert lors de l'audit de la fuite inter-société sur
-- `AdherentService` (PROGRESSION.md, prompt filière SOCIETE_AFFILIEE) :
-- n'importe quel compte `authenticated` de l'organisation — y compris
-- SOCIETE_ASSUREE/COMPTABLE/RECEPTION — satisfaisait la policy `organisation_id
-- = profils.organisation_id` et pouvait donc lire TOUTES les réclamations de
-- TOUTES les sociétés clientes.
--
-- Ce trou est distinct du bug applicatif corrigé dans `ClaimsService`
-- (`assertLecture`, ROLES_LECTURE_CLAIMS) : NestJS se connecte en `postgres`
-- (BYPASSRLS actif, cf. ADR-002 dans ARCHITECTURE-DECISIONS.md) et ne passe
-- JAMAIS par cette policy — mais un accès direct `authenticated` (PostgREST /
-- client Supabase côté navigateur, hors NestJS) l'aurait fait, sans aucune
-- restriction de rôle. Les deux corrections sont nécessaires et indépendantes.
--
-- Scoping société non traité ici (comme côté NestJS) : `reclamations` n'a pas
-- de colonne société/souscripteur directe (police_id/adherent_id seulement) —
-- à faire dans un prompt dédié avant d'exposer une vue réclamations à un rôle
-- SOCIETE_*. En attendant, lecture réservée au personnel ASSUREUR habilité,
-- alignée sur `ROLES_LECTURE_CLAIMS` (apps/api/src/claims/claims.types.ts).
-- ===========================================================================

drop policy if exists reclamations_lecture on public.reclamations;
create policy reclamations_lecture on public.reclamations
  for select to authenticated
  using (
    public.profil_a_role(
      organisation_id,
      array[
        'ASSUREUR_DIRECTION',
        'ASSUREUR_EXPLOITATION',
        'ASSUREUR_INFORMATIQUE',
        'ASSUREUR_MEDECIN_CONSEIL'
      ]
    )
  );

drop policy if exists remboursements_lecture on public.remboursements;
create policy remboursements_lecture on public.remboursements
  for select to authenticated
  using (
    exists (
      select 1
      from public.reclamations r
      where r.id = remboursements.reclamation_id
        and public.profil_a_role(
          r.organisation_id,
          array[
            'ASSUREUR_DIRECTION',
            'ASSUREUR_EXPLOITATION',
            'ASSUREUR_INFORMATIQUE',
            'ASSUREUR_MEDECIN_CONSEIL'
          ]
        )
    )
  );
