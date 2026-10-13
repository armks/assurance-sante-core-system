-- 088 — Contacts d'un bénéficiaire (téléphone, e-mail) : facultatifs (un enfant peut n'avoir aucun contact), formats contrôlés par l'API.
-- Idempotente.
ALTER TABLE public.beneficiaires ADD COLUMN IF NOT EXISTS telephone text;
ALTER TABLE public.beneficiaires ADD COLUMN IF NOT EXISTS email text;
