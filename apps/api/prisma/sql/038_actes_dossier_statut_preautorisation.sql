alter table public.actes_dossier
  add column if not exists statut_preautorisation text not null default 'NON_REQUISE'
    check (statut_preautorisation in (
      'NON_REQUISE',
      'EN_ATTENTE_VALIDATION',
      'APPROUVEE',
      'REFUSEE'
    ));
