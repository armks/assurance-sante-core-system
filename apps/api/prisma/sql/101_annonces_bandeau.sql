-- 101 — Annonces du bandeau défilant (bas de la page d'accueil).
--
--   Un court message défile de gauche à droite dans un bandeau fixé au bas de la page d'accueil, apparaît par le bas, puis disparaît
--   après `duree_affichage_secondes`. Portée : `organisation_id` renseigné = page d'accueil personnalisée (/{slug}) de cette société ;
--   NULL = diffusion plateforme (toutes les pages d'accueil), réservée au superadmin. Gestion : ASSUREUR_INFORMATIQUE de la société
--   (ses propres annonces) et superadmin (toutes) — vérifié par NestJS, qui est seul à lire / écrire cette table (aucune politique
--   RLS : accès direct refusé). La lecture publique passe par l'API (`GET /public/annonces`), qui ne renvoie que les annonces actives
--   dans leur fenêtre de dates.
--
-- Idempotente : rejouable sans erreur.

CREATE TABLE IF NOT EXISTS public.annonces_bandeau (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid REFERENCES public.organisations (id),
  texte                     text        NOT NULL,
  duree_affichage_secondes  integer     NOT NULL DEFAULT 30,
  date_debut                timestamptz NOT NULL DEFAULT now(),
  date_fin                  timestamptz,
  actif                     boolean     NOT NULL DEFAULT true,
  cree_par                  uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  CONSTRAINT annonces_bandeau_texte_longueur CHECK (char_length(texte) BETWEEN 3 AND 300),
  CONSTRAINT annonces_bandeau_duree CHECK (duree_affichage_secondes BETWEEN 5 AND 600),
  CONSTRAINT annonces_bandeau_fenetre CHECK (date_fin IS NULL OR date_fin > date_debut)
);

CREATE INDEX IF NOT EXISTS annonces_bandeau_organisation
  ON public.annonces_bandeau (organisation_id, date_debut)
  WHERE deleted_at IS NULL;

ALTER TABLE public.annonces_bandeau ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.annonces_bandeau FROM anon, authenticated;
