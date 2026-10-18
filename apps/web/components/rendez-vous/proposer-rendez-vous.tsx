'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { chargerMedecins, proposerRendezVous, rechercherEtablissements, rechercherPatients } from '@/app/rendez-vous-actions';
import { ChampSelect, ChampTexte, FormulaireModal } from '@/components/dashboard/patterns';
import { SelecteurCreneau } from '@/components/rendez-vous/selecteur-creneau';
import { LIBELLE_LIEN, type EtablissementRecherche, type MedecinAgenda, type PatientRecherche } from '@/lib/rendez-vous';
import { cn } from '@/lib/utils';

function ChampsProposition() {
  const [q, setQ] = useState('');
  const [patients, setPatients] = useState<PatientRecherche[]>([]);
  const [patient, setPatient] = useState<PatientRecherche | null>(null);
  const [etablissements, setEtablissements] = useState<EtablissementRecherche[]>([]);
  const [etablissementId, setEtablissementId] = useState('');
  const [medecins, setMedecins] = useState<MedecinAgenda[]>([]);
  const [medecinId, setMedecinId] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    void rechercherEtablissements('').then((r) => (r.ok ? setEtablissements(r.data) : setErreur(r.error)));
  }, []);

  useEffect(() => {
    if (patient || q.trim().length < 2) {
      setPatients([]);
      return;
    }
    const t = setTimeout(() => void rechercherPatients(q.trim()).then((r) => (r.ok ? setPatients(r.data) : setErreur(r.error))), 250);
    return () => clearTimeout(t);
  }, [q, patient]);

  useEffect(() => {
    setMedecinId('');
    setMedecins([]);
    if (!etablissementId) return;
    void chargerMedecins(etablissementId).then((r) => (r.ok ? setMedecins(r.data) : setErreur(r.error)));
  }, [etablissementId]);

  return (
    <>
      {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
      <input type="hidden" name="adherentId" value={patient?.adherentId ?? ''} />
      <input type="hidden" name="beneficiaireId" value={patient?.beneficiaireId ?? ''} />
      <div className="space-y-1">
        <label htmlFor="rdv-patient" className="text-sm font-medium">Patient</label>
        {patient ? (
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span>
              <strong>{patient.nom}</strong> — {LIBELLE_LIEN[patient.lien] ?? patient.lien}
              {patient.numeroCarte ? ` — ${patient.numeroCarte}` : ''}
            </span>
            <button type="button" className="text-xs underline" onClick={() => { setPatient(null); setQ(''); }}>Changer</button>
          </div>
        ) : (
          <>
            <input
              id="rdv-patient"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, prénom ou n° de carte (2 caractères minimum)…"
              maxLength={60}
              className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
              autoComplete="off"
            />
            {patients.length > 0 && (
              <ul className="max-h-44 divide-y overflow-y-auto rounded-md border">
                {patients.map((p) => (
                  <li key={`${p.adherentId}-${p.beneficiaireId ?? 'titulaire'}`}>
                    <button type="button" className={cn('w-full px-3 py-1.5 text-left text-sm hover:bg-muted')} onClick={() => setPatient(p)}>
                      <strong>{p.nom}</strong> <span className="text-muted-foreground">— {LIBELLE_LIEN[p.lien] ?? p.lien}{p.numeroCarte ? ` — ${p.numeroCarte}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <ChampSelect
        name="etablissementId"
        label="Établissement sanitaire"
        required
        placeholder="Choisir l’établissement…"
        value={etablissementId}
        onChange={(e) => setEtablissementId(e.target.value)}
        options={etablissements.map((e) => ({ valeur: e.id, libelle: `${e.nom}${e.commune || e.ville ? ` — ${e.commune ?? e.ville}` : ''}` }))}
      />
      <ChampSelect
        name="medecinId"
        label="Médecin"
        required
        placeholder={etablissementId ? (medecins.length ? 'Choisir le médecin…' : 'Aucun médecin dans cet établissement') : 'Choisissez d’abord l’établissement'}
        value={medecinId}
        onChange={(e) => setMedecinId(e.target.value)}
        disabled={!etablissementId}
        options={medecins.map((m) => ({ valeur: m.id, libelle: m.nom }))}
      />
      <SelecteurCreneau medecinId={medecinId || null} />
      <ChampTexte name="motif" label="Motif du rendez-vous" maxLength={300} aide="Facultatif." />
    </>
  );
}

/** Proposition d'un rendez-vous pour un patient : la secrétaire de l'assurance et l'exploitation choisissent établissement, médecin et créneau libre. */
export function ProposerRendezVous({ racine }: { racine: string }) {
  const router = useRouter();
  return (
    <FormulaireModal
      titre="Proposer un rendez-vous"
      description="Le rendez-vous est proposé à l’établissement : son accueil ou le médecin concerné le confirme ou le modifie."
      declencheurLabel="Proposer un rendez-vous"
      libelleSoumettre="Envoyer la proposition"
      onSoumettre={async (fd) => {
        const adherentId = String(fd.get('adherentId') ?? '');
        const debut = String(fd.get('debut') ?? '');
        if (!adherentId) return { ok: false, error: 'Choisissez le patient.' };
        if (!debut) return { ok: false, error: 'Choisissez un créneau.' };
        return proposerRendezVous(
          {
            etablissementId: String(fd.get('etablissementId') ?? ''),
            medecinId: String(fd.get('medecinId') ?? ''),
            adherentId,
            beneficiaireId: String(fd.get('beneficiaireId') ?? '') || undefined,
            debut,
            motif: String(fd.get('motif') ?? '') || undefined,
          },
          racine,
        );
      }}
      onSucces={() => router.refresh()}
    >
      <ChampsProposition />
    </FormulaireModal>
  );
}
