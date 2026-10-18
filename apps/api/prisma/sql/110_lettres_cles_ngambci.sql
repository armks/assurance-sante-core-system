-- Lettres-clés de la Nomenclature générale des actes de médecine et de biologie de Côte d'Ivoire (NGAMBCI, décembre 2019,
-- Comité technique CMU). Les libellés viennent du texte officiel : tableau « lettres du code » et « lettres clés des actes
-- paramédicaux » (p. 9), tableau des regroupements (p. 8) et libellés des actes de consultation et de visite (p. 7).
-- Aucune valeur en FCFA : les valeurs des lettres-clés se négocient établissement par établissement (conventions).
-- Idempotente : rejouable sans erreur.

-- Quatre lettres officielles comptent 5 caractères (CNPSY, VNPSY, VNINF, VFINF) : le code passe de 1-4 à 1-6 lettres.
ALTER TABLE public.lettres_cles DROP CONSTRAINT IF EXISTS lettres_cles_code_check;
ALTER TABLE public.lettres_cles ADD CONSTRAINT lettres_cles_code_check CHECK (code ~ '^[A-Z]{1,6}$');

-- libellés d'amorçage neutres (« Lettre-clé X ») remplacés par les libellés officiels ; un libellé déjà personnalisé n'est jamais écrasé
UPDATE public.lettres_cles SET libelle = 'Actes techniques médicaux et actes pratiqués par les médecins', updated_at = now() WHERE code = 'K'  AND libelle = 'Lettre-clé K';
UPDATE public.lettres_cles SET libelle = 'Actes de chirurgie et d’obstétrique',                           updated_at = now() WHERE code = 'KC' AND libelle = 'Lettre-clé KC';
UPDATE public.lettres_cles SET libelle = 'Actes d’anesthésie',                                            updated_at = now() WHERE code = 'KA' AND libelle = 'Lettre-clé KA';
UPDATE public.lettres_cles SET libelle = 'Actes d’échographie',                                           updated_at = now() WHERE code = 'KE' AND libelle = 'Lettre-clé KE';
UPDATE public.lettres_cles SET libelle = 'Actes d’imagerie (radiologues et radiothérapeutes)',            updated_at = now() WHERE code = 'Z'  AND libelle = 'Lettre-clé Z';
UPDATE public.lettres_cles SET libelle = 'Actes pratiqués par les dentistes',                             updated_at = now() WHERE code = 'D'  AND libelle = 'Lettre-clé D';
UPDATE public.lettres_cles SET libelle = 'Actes de biologie médicale',                                    updated_at = now() WHERE code = 'B'  AND libelle = 'Lettre-clé B';
UPDATE public.lettres_cles SET libelle = 'Actes pratiqués par les psychologues cliniciens',               updated_at = now() WHERE code = 'P'  AND libelle = 'Lettre-clé P';
UPDATE public.lettres_cles SET libelle = 'Actes pratiqués par l’infirmier ou l’infirmière',               updated_at = now() WHERE code = 'AMI' AND libelle = 'Lettre-clé AMI';
UPDATE public.lettres_cles SET libelle = 'Actes pratiqués par le masseur kinésithérapeute',               updated_at = now() WHERE code = 'AMK' AND libelle = 'Lettre-clé AMK';

-- lettres-clés manquantes
INSERT INTO public.lettres_cles (code, libelle, ordre) VALUES
  ('DC',     'Actes de chirurgie dentaire',                                                                                               45),
  ('CD',     'Consultation au cabinet du médecin dentiste',                                                                              110),
  ('CDS',    'Consultation au cabinet du médecin dentiste spécialiste',                                                                  120),
  ('CNPSY',  'Consultation au cabinet du médecin psychiatre ou neurologue',                                                              130),
  ('CSF',    'Consultation de la sage-femme',                                                                                            140),
  ('CINF',   'Consultation de l’infirmier (CInf)',                                                                                       150),
  ('V',      'Visite du médecin généraliste',                                                                                            160),
  ('VD',     'Visite du médecin dentiste',                                                                                               170),
  ('VS',     'Visite du médecin spécialiste',                                                                                            180),
  ('VNPSY',  'Visite du médecin psychiatre',                                                                                             190),
  ('VSF',    'Visite de la sage-femme',                                                                                                  200),
  ('VINF',   'Visite de l’infirmier (VInf)',                                                                                             210),
  ('VNINF',  'Visite à domicile de nuit (de 21 h à 7h) de l’infirmier (VNInf)',                                                          220),
  ('VFINF',  'Visite à domicile dimanche et jours fériés de l’infirmier (VFInf)',                                                        230),
  ('VN',     'Visite à domicile de nuit (de 21 h à 7h) du médecin généraliste, médecin spécialiste, chirurgien-dentiste et sage-femme',   240),
  ('VF',     'Visite à domicile dimanche et jours fériés du médecin généraliste, médecin spécialiste, chirurgien-dentiste et sage-femme', 250),
  ('SF',     'Actes pratiqués par la sage-femme',                                                                                        260),
  ('SFI',    'Soins infirmiers pratiqués par la sage-femme',                                                                             270),
  ('AMM',    'Actes pratiqués par un physiothérapeute',                                                                                  280),
  ('AMO',    'Actes pratiqués par l’orthophoniste',                                                                                      290),
  ('AMY',    'Actes pratiqués par l’orthoptiste (séances de rééducation, par séance)',                                                   300)
ON CONFLICT (code) DO NOTHING;
