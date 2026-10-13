-- 086 — La société cliente PROPOSE ses adhérents et bénéficiaires, l'assureur valide ou rejette (motif).
--
--   1. propositions_membres : UNE ligne par proposition (adhérent ou bénéficiaire), avec statut EN_ATTENTE | VALIDEE | REJETEE | RETIREE,
--      motif de rejet, décideur, date et identifiant de l'élément créé. Rien n'est créé dans `adherents` / `beneficiaires` avant la validation.
--      Adhérent : formule rattachée (police), sexe, et au moins un contact (téléphone ou e-mail) obligatoires.
--   2. regles_provisioning : SOCIETE_RECEPTION peut générer le lien d'invitation d'un ADHERENT_TITULAIRE de SA société
--      (les règles ASSUREUR_INFORMATIQUE et SOCIETE_ADMINISTRATION existent depuis 030). `peut_inviter_role()` lit ces règles dynamiquement.
--
-- Idempotente : rejouable sans erreur.

CREATE TABLE IF NOT EXISTS public.propositions_membres (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      uuid NOT NULL REFERENCES public.organisations (id) ON DELETE RESTRICT,
  souscripteur_id      uuid NOT NULL REFERENCES public.souscripteurs (id) ON DELETE RESTRICT,
  type                 text NOT NULL CHECK (type IN ('ADHERENT', 'BENEFICIAIRE')),
  statut               text NOT NULL DEFAULT 'EN_ATTENTE' CHECK (statut IN ('EN_ATTENTE', 'VALIDEE', 'REJETEE', 'RETIREE')),
  nom                  text NOT NULL CHECK (length(btrim(nom)) > 0),
  prenom               text NOT NULL CHECK (length(btrim(prenom)) > 0),
  date_naissance       date NOT NULL,
  sexe                 text NOT NULL CHECK (sexe IN ('M', 'F')),
  -- adhérent : formule rattachée = police active de la société, et contacts
  police_id            uuid REFERENCES public.polices (id) ON DELETE RESTRICT,
  telephone            text,
  email                text,
  -- bénéficiaire : adhérent titulaire existant de la société et lien de parenté
  adherent_parent_id   uuid REFERENCES public.adherents (id) ON DELETE RESTRICT,
  lien_parente         text,
  motif_rejet          text,
  propose_par          uuid NOT NULL REFERENCES public.profils (id) ON DELETE RESTRICT,
  decide_par           uuid REFERENCES public.profils (id) ON DELETE RESTRICT,
  date_decision        timestamptz,
  adherent_cree_id     uuid REFERENCES public.adherents (id) ON DELETE RESTRICT,
  beneficiaire_cree_id uuid REFERENCES public.beneficiaires (id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT propositions_membres_adherent_complet CHECK (
    type <> 'ADHERENT'
    OR (police_id IS NOT NULL AND (nullif(btrim(coalesce(telephone, '')), '') IS NOT NULL OR nullif(btrim(coalesce(email, '')), '') IS NOT NULL))
  ),
  CONSTRAINT propositions_membres_beneficiaire_complet CHECK (
    type <> 'BENEFICIAIRE' OR (adherent_parent_id IS NOT NULL AND lien_parente IS NOT NULL)
  ),
  CONSTRAINT propositions_membres_rejet_motive CHECK (
    statut <> 'REJETEE' OR length(btrim(coalesce(motif_rejet, ''))) >= 5
  ),
  CONSTRAINT propositions_membres_decision_tracee CHECK (
    statut IN ('EN_ATTENTE', 'RETIREE') OR (decide_par IS NOT NULL AND date_decision IS NOT NULL)
  ),
  CONSTRAINT propositions_membres_validee_creee CHECK (
    statut <> 'VALIDEE' OR (adherent_cree_id IS NOT NULL OR beneficiaire_cree_id IS NOT NULL)
  )
);

-- une seule proposition d'adhérent EN_ATTENTE par e-mail dans une organisation
CREATE UNIQUE INDEX IF NOT EXISTS propositions_membres_email_en_attente
  ON public.propositions_membres (organisation_id, lower(email))
  WHERE statut = 'EN_ATTENTE' AND type = 'ADHERENT' AND email IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS propositions_membres_file_idx
  ON public.propositions_membres (organisation_id, statut, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS propositions_membres_societe_idx
  ON public.propositions_membres (souscripteur_id, statut) WHERE deleted_at IS NULL;

-- accès uniquement par l'API (rôle propriétaire) : aucune lecture directe par les rôles Supabase
ALTER TABLE public.propositions_membres ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------ 2. invitation d'un adhérent par la réception de la société
INSERT INTO public.regles_provisioning (role_createur, role_cree, scope_verifie, mode, role_validateur)
VALUES ('SOCIETE_RECEPTION', 'ADHERENT_TITULAIRE', 'societe_id', 'CREATION_DIRECTE', NULL)
ON CONFLICT ON CONSTRAINT regles_provisioning_unique DO NOTHING;
