export interface EtablissementDetail {
  nom: string;
  code: string;
  type: string;
  localisation: string | null;
  adresse: string | null;
  telephone: string | null;
}

export interface PatientSoigne {
  nom: string;
  prenom: string;
  numeroCarte: string | null;
}

const LIBELLE_TYPE_ETABLISSEMENT: Record<string, string> = {
  PHARMACIE: 'Pharmacie',
  HOPITAL_PUBLIC: 'Hôpital public',
  CLINIQUE_PRIVEE: 'Clinique privée',
  CABINET_MEDICAL: 'Cabinet médical',
  CENTRE_SANTE: 'Centre de santé',
  LABORATOIRE: 'Laboratoire',
  CENTRE_IMAGERIE: 'Centre d’imagerie',
  OPTICIEN: 'Opticien',
  DENTISTE: 'Dentiste',
  MATERNITE: 'Maternité',
};

/**
 * Deux cadres du détail d'un soin dans l'espace adhérent : l'établissement sanitaire (ou la pharmacie) visité et la
 * personne qui a bénéficié des soins (nom et n° de carte).
 */
export function BlocEtablissementPatient({
  etablissement,
  nomEtablissement,
  patient,
}: {
  etablissement?: EtablissementDetail | null;
  /** Repli quand seule le nom est connu. */
  nomEtablissement?: string | null;
  patient?: PatientSoigne | null;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-md border p-2.5 text-sm" data-testid="detail-etablissement">
        <p className="text-xs text-muted-foreground">Établissement sanitaire / pharmacie visité</p>
        <p className="font-medium">{etablissement?.nom ?? nomEtablissement ?? '—'}</p>
        {etablissement && (
          <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
            <p>
              {LIBELLE_TYPE_ETABLISSEMENT[etablissement.type] ?? etablissement.type} · <span className="font-mono">{etablissement.code}</span>
            </p>
            {(etablissement.adresse || etablissement.localisation) && (
              <p>{[etablissement.adresse, etablissement.localisation].filter(Boolean).join(' — ')}</p>
            )}
            {etablissement.telephone && <p>Tél. {etablissement.telephone}</p>}
          </div>
        )}
      </div>
      <div className="rounded-md border p-2.5 text-sm" data-testid="detail-patient">
        <p className="text-xs text-muted-foreground">Personne soignée</p>
        {patient ? (
          <>
            <p className="font-medium">
              {patient.prenom} {patient.nom}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              N° de carte : <span className="font-mono text-foreground">{patient.numeroCarte ?? '—'}</span>
            </p>
          </>
        ) : (
          <p>—</p>
        )}
      </div>
    </div>
  );
}
