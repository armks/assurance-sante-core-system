-- 091 — Le calcul du coût reste synchronisé avec le CATALOGUE NATIONAL (ADR-009, ADR-008).
--
-- Le microservice Java résout le tarif d'un acte à partir de la COTATION (lettre-clé × coefficient) lue sur la ligne d'activation de
-- l'organisation (`referentiel_actes`), copiée du catalogue national à l'activation. Si le superadmin corrige ensuite la cotation (ou le
-- libellé / la catégorie) au catalogue national, la copie resterait périmée et le coût serait calculé sur l'ancienne valeur.
--
--   1. Déclencheur : toute modification d'un acte du catalogue national est propagée, dans la MÊME transaction, à toutes les lignes
--      d'activation liées (`catalogue_national_id`) — quelle que soit la voie (écran superadmin, import Excel, SQL). Le CODE ne change jamais.
--   2. Même principe pour les médicaments (identification, prix de référence, taux) lus par le Java pour la dispensation.
--   3. Le statut de la ligne (activation) n'est JAMAIS touché par la propagation.
--   4. Rattrapage immédiat des lignes déjà désynchronisées.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.referentiel_national_actes_propager() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.referentiel_actes r
     SET libelle = NEW.libelle, categorie = NEW.categorie, version_nomenclature = NEW.version_nomenclature,
         lettre_cle_code = NEW.lettre_cle_code, coefficient = NEW.coefficient, mode_cotation = NEW.mode_cotation,
         categorie_garantie = NEW.categorie_garantie, groupe_code = NEW.groupe_code, updated_at = now()
   WHERE r.catalogue_national_id = NEW.id AND r.deleted_at IS NULL
     AND (r.libelle, r.categorie, r.version_nomenclature, r.lettre_cle_code, r.coefficient, r.mode_cotation, r.categorie_garantie, r.groupe_code)
         IS DISTINCT FROM
         (NEW.libelle, NEW.categorie, NEW.version_nomenclature, NEW.lettre_cle_code, NEW.coefficient, NEW.mode_cotation, NEW.categorie_garantie, NEW.groupe_code);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referentiel_national_actes_propager ON public.referentiel_national_actes;
CREATE TRIGGER referentiel_national_actes_propager
  AFTER UPDATE OF libelle, categorie, version_nomenclature, lettre_cle_code, coefficient, mode_cotation, categorie_garantie, groupe_code
  ON public.referentiel_national_actes
  FOR EACH ROW EXECUTE FUNCTION public.referentiel_national_actes_propager();

CREATE OR REPLACE FUNCTION public.referentiel_national_medicaments_propager() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.medicaments m
     SET denomination_commune = NEW.denomination_commune, nom_commercial = NEW.nom_commercial, code_ean = NEW.code_ean, forme = NEW.forme,
         dosage = NEW.dosage, conditionnement = NEW.conditionnement, classe_therapeutique = NEW.classe_therapeutique,
         remboursable = NEW.remboursable, taux_remboursement_std = NEW.taux_remboursement_std, prix_reference_xof = NEW.prix_reference_xof,
         prix_max_remboursable = NEW.prix_max_remboursable, medicament_essentiel = NEW.medicament_essentiel,
         generique_disponible = NEW.generique_disponible, ordonnance_obligatoire = NEW.ordonnance_obligatoire,
         medicament_controle = NEW.medicament_controle, usage = NEW.usage, updated_at = now()
   WHERE m.catalogue_national_id = NEW.id AND m.deleted_at IS NULL
     AND (m.denomination_commune, m.nom_commercial, m.code_ean, m.forme, m.dosage, m.conditionnement, m.classe_therapeutique, m.remboursable,
          m.taux_remboursement_std, m.prix_reference_xof, m.prix_max_remboursable, m.medicament_essentiel, m.generique_disponible,
          m.ordonnance_obligatoire, m.medicament_controle, m.usage)
         IS DISTINCT FROM
         (NEW.denomination_commune, NEW.nom_commercial, NEW.code_ean, NEW.forme, NEW.dosage, NEW.conditionnement, NEW.classe_therapeutique,
          NEW.remboursable, NEW.taux_remboursement_std, NEW.prix_reference_xof, NEW.prix_max_remboursable, NEW.medicament_essentiel,
          NEW.generique_disponible, NEW.ordonnance_obligatoire, NEW.medicament_controle, NEW.usage);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referentiel_national_medicaments_propager ON public.referentiel_national_medicaments;
CREATE TRIGGER referentiel_national_medicaments_propager
  AFTER UPDATE OF denomination_commune, nom_commercial, code_ean, forme, dosage, conditionnement, classe_therapeutique, remboursable,
                  taux_remboursement_std, prix_reference_xof, prix_max_remboursable, medicament_essentiel, generique_disponible,
                  ordonnance_obligatoire, medicament_controle, usage
  ON public.referentiel_national_medicaments
  FOR EACH ROW EXECUTE FUNCTION public.referentiel_national_medicaments_propager();

-- rattrapage : lignes déjà désynchronisées
UPDATE public.referentiel_actes r
   SET libelle = n.libelle, categorie = n.categorie, version_nomenclature = n.version_nomenclature, lettre_cle_code = n.lettre_cle_code,
       coefficient = n.coefficient, mode_cotation = n.mode_cotation, categorie_garantie = n.categorie_garantie, groupe_code = n.groupe_code,
       updated_at = now()
  FROM public.referentiel_national_actes n
 WHERE r.catalogue_national_id = n.id AND r.deleted_at IS NULL
   AND (r.libelle, r.categorie, r.version_nomenclature, r.lettre_cle_code, r.coefficient, r.mode_cotation, r.categorie_garantie, r.groupe_code)
       IS DISTINCT FROM
       (n.libelle, n.categorie, n.version_nomenclature, n.lettre_cle_code, n.coefficient, n.mode_cotation, n.categorie_garantie, n.groupe_code);
