-- 093 — Liste des médicaments remboursables de la pharmacie : rattachement au catalogue national et note libre.
-- La liste d'une pharmacie = médicaments du catalogue national (activés par l'assureur) que son pharmacien a ajoutés,
-- avec leur disponibilité et une note. Elle ne porte JAMAIS de tarif : le prix national reste dans le catalogue, le prix
-- pratiqué est saisi au comptoir. Idempotente.
ALTER TABLE public.stock_medicaments_pharmacie ADD COLUMN IF NOT EXISTS catalogue_national_id uuid;
ALTER TABLE public.stock_medicaments_pharmacie ADD COLUMN IF NOT EXISTS note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_medicaments_pharmacie_note_longueur') THEN
    ALTER TABLE public.stock_medicaments_pharmacie ADD CONSTRAINT stock_medicaments_pharmacie_note_longueur CHECK (note IS NULL OR char_length(note) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_medicaments_pharmacie_catalogue_fk') THEN
    ALTER TABLE public.stock_medicaments_pharmacie
      ADD CONSTRAINT stock_medicaments_pharmacie_catalogue_fk FOREIGN KEY (catalogue_national_id) REFERENCES public.referentiel_national_medicaments (id);
  END IF;
END $$;
-- un médicament du catalogue ne figure qu'une fois dans la liste d'une pharmacie
CREATE UNIQUE INDEX IF NOT EXISTS stock_medicaments_pharmacie_catalogue_uniq
  ON public.stock_medicaments_pharmacie (pharmacie_id, catalogue_national_id) WHERE catalogue_national_id IS NOT NULL;
