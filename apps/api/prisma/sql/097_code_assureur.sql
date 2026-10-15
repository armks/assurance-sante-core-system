-- 097 — Code assureur : numéro unique et distinct par société (assureur / mutuelle).
--
--   Toutes les données métier portent déjà `organisation_id` (et les politiques RLS filtrent dessus) : le code assureur est
--   l'identifiant lisible de cette organisation, utilisé pour séparer et retrouver les données par pays et par assureur.
--   Saisi à la création de la société ; à défaut, attribué automatiquement (séquence à partir de 1001).
--   3 à 8 chiffres, unique sur toutes les sociétés (y compris archivées : un code n'est jamais réutilisé).
--
-- Idempotente : rejouable sans erreur.

CREATE SEQUENCE IF NOT EXISTS public.organisations_code_assureur_seq START 1001;

ALTER TABLE public.organisations ADD COLUMN IF NOT EXISTS code_assureur text;

-- Sociétés existantes : numérotées dans l'ordre de création.
UPDATE public.organisations o
   SET code_assureur = n.code
  FROM (
    SELECT id, nextval('public.organisations_code_assureur_seq')::text AS code
      FROM (SELECT id FROM public.organisations WHERE code_assureur IS NULL ORDER BY created_at, id) t
  ) n
 WHERE o.id = n.id;

ALTER TABLE public.organisations
  ALTER COLUMN code_assureur SET DEFAULT nextval('public.organisations_code_assureur_seq')::text;
ALTER TABLE public.organisations ALTER COLUMN code_assureur SET NOT NULL;

ALTER TABLE public.organisations DROP CONSTRAINT IF EXISTS organisations_code_assureur_format;
ALTER TABLE public.organisations
  ADD CONSTRAINT organisations_code_assureur_format CHECK (code_assureur ~ '^[0-9]{3,8}$');

CREATE UNIQUE INDEX IF NOT EXISTS organisations_code_assureur_key ON public.organisations (code_assureur);
