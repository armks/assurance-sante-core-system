-- 100 — Catégories d'établissement et niveau d'accès de la formule.
--
--   Les établissements sont rangés en catégories HIÉRARCHISÉES (niveau croissant) : centre médical < hôpital public < clinique
--   < polyclinique. Chaque formule (produit) porte un NIVEAU D'ACCÈS = la catégorie la plus haute à laquelle elle donne droit :
--   une formule de niveau supérieur donne accès aux établissements des niveaux inférieurs, jamais l'inverse (une formule
--   « centre médical » ne donne pas accès à une polyclinique). La règle est appliquée à l'ouverture du dossier et à la demande
--   de code de consultation (MoteurOuvertureDossier).
--
--   Existant : chaque établissement reçoit la catégorie déduite de son type ; chaque produit reçoit le niveau le plus haut
--   (aucune restriction : le comportement actuel est conservé tant que l'assureur ne restreint pas une formule).
--
-- Idempotente : rejouable sans erreur.

CREATE TABLE IF NOT EXISTS public.categories_etablissement (
  code    text PRIMARY KEY,
  libelle text    NOT NULL,
  niveau  integer NOT NULL UNIQUE CHECK (niveau > 0),
  actif   boolean NOT NULL DEFAULT true
);

INSERT INTO public.categories_etablissement (code, libelle, niveau) VALUES
  ('CENTRE_MEDICAL', 'Centre médical', 1),
  ('HOPITAL_PUBLIC', 'Hôpital public', 2),
  ('CLINIQUE',       'Clinique',       3),
  ('POLYCLINIQUE',   'Polyclinique',   4)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.categories_etablissement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_etablissement_lecture ON public.categories_etablissement;
CREATE POLICY categories_etablissement_lecture ON public.categories_etablissement
  FOR SELECT TO authenticated USING (true);

-- Établissements : catégorie (déduite du type pour l'existant)
ALTER TABLE public.etablissements_sante ADD COLUMN IF NOT EXISTS categorie_etablissement text;
UPDATE public.etablissements_sante SET categorie_etablissement = CASE type_etablissement
    WHEN 'HOPITAL_PUBLIC'  THEN 'HOPITAL_PUBLIC'
    WHEN 'CLINIQUE_PRIVEE' THEN 'CLINIQUE'
    ELSE 'CENTRE_MEDICAL'
  END
 WHERE categorie_etablissement IS NULL;
ALTER TABLE public.etablissements_sante ALTER COLUMN categorie_etablissement SET DEFAULT 'CENTRE_MEDICAL';
ALTER TABLE public.etablissements_sante ALTER COLUMN categorie_etablissement SET NOT NULL;
ALTER TABLE public.etablissements_sante DROP CONSTRAINT IF EXISTS etablissements_sante_categorie_fkey;
ALTER TABLE public.etablissements_sante
  ADD CONSTRAINT etablissements_sante_categorie_fkey FOREIGN KEY (categorie_etablissement) REFERENCES public.categories_etablissement (code);

-- Produits : niveau d'accès (catégorie la plus haute couverte)
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS niveau_acces_etablissement text;
UPDATE public.produits SET niveau_acces_etablissement = 'POLYCLINIQUE' WHERE niveau_acces_etablissement IS NULL;
ALTER TABLE public.produits ALTER COLUMN niveau_acces_etablissement SET DEFAULT 'POLYCLINIQUE';
ALTER TABLE public.produits ALTER COLUMN niveau_acces_etablissement SET NOT NULL;
ALTER TABLE public.produits DROP CONSTRAINT IF EXISTS produits_niveau_acces_fkey;
ALTER TABLE public.produits
  ADD CONSTRAINT produits_niveau_acces_fkey FOREIGN KEY (niveau_acces_etablissement) REFERENCES public.categories_etablissement (code);
