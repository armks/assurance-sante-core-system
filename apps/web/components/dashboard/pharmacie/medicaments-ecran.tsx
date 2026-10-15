'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ajouterMedicamentAMaListe,
  creerMedicamentCatalogue,
  modifierMedicamentDeMaListe,
  retirerMedicamentDeMaListe,
} from '@/app/dashboard-pharmacie/liste-medicaments-actions';
import {
  ChampCheckbox,
  ChampNombre,
  ChampTexte,
  ConfirmationAction,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { LIBELLE_STATUT_HOMOLOGATION } from '@/lib/referentiel';

/** Médicament du catalogue national activé par l'assureur, avec l'état dans la liste de la pharmacie. */
export interface MedicamentReference {
  id: string;
  denominationCommune: string;
  nomCommercial: string | null;
  dosage: string | null;
  forme: string | null;
  classeTherapeutique: string | null;
  remboursable: boolean;
  tauxRemboursementStd: string | number | null;
  prixReferenceXof: string | number | null;
  medicamentEssentiel: boolean;
  /** Statut dans le catalogue national (HOMOLOGUE, EN_ATTENTE…). */
  statutHomologation: string;
  /** Homologué ET activé par l'assureur de la pharmacie : seul un tel médicament peut être ajouté à la liste. */
  activee: boolean;
  dansMaListe: boolean;
  disponible: boolean | null;
  note: string | null;
}

const montant = (v: string | number | null) => (v === null ? '—' : `${Number(v).toLocaleString('fr-FR')} F`);
const pourcent = (v: string | number | null) => (v === null ? '—' : `${Number(v)} %`);

/**
 * « Médicaments remboursables » de la pharmacie : les médicaments du catalogue national activés par son assureur (aucun acte).
 * Le pharmacien ajoute à SA liste, signale la disponibilité et note ; le catalogue et son prix national restent en lecture seule.
 */
export function MedicamentsEcran({ medicaments, peutModifier }: { medicaments: MedicamentReference[]; peutModifier: boolean }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const rafraichir = () => router.refresh();

  const colonnes: ColonneTable<MedicamentReference>[] = [
    {
      cle: 'denominationCommune',
      entete: 'Dénomination',
      triable: true,
      rendu: (m) => (
        <div>
          <p className="font-medium">{m.denominationCommune}</p>
          {m.nomCommercial && <p className="text-xs text-muted-foreground">{m.nomCommercial}</p>}
        </div>
      ),
    },
    { cle: 'presentation', entete: 'Présentation', rendu: (m) => [m.forme, m.dosage].filter(Boolean).join(' · ') || '—' },
    { cle: 'classeTherapeutique', entete: 'Classe', rendu: (m) => m.classeTherapeutique ?? '—' },
    {
      cle: 'statutHomologation',
      entete: 'Statut',
      rendu: (m) => <StatutBadge statut={m.statutHomologation} libelles={LIBELLE_STATUT_HOMOLOGATION} />,
    },
    {
      cle: 'tauxRemboursementStd',
      entete: 'Taux standard',
      aligneDroite: true,
      valeur: (m) => Number(m.tauxRemboursementStd ?? 0),
      rendu: (m) => pourcent(m.tauxRemboursementStd),
    },
    {
      cle: 'prixReferenceXof',
      entete: 'Prix national (lecture seule)',
      aligneDroite: true,
      valeur: (m) => Number(m.prixReferenceXof ?? 0),
      rendu: (m) => montant(m.prixReferenceXof),
    },
    {
      cle: 'dansMaListe',
      entete: 'Ma liste',
      valeur: (m) => (m.dansMaListe ? 'oui' : 'non'),
      rendu: (m) =>
        !m.dansMaListe ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : m.disponible === false ? (
          <StatutBadge statut="INDISPONIBLE" ton="danger" libelle="Indisponible" />
        ) : (
          <StatutBadge statut="DISPONIBLE" ton="succes" libelle="Disponible" />
        ),
    },
    {
      cle: 'note',
      entete: 'Note',
      rendu: (m) => <span className="text-xs text-muted-foreground">{m.note ?? ''}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Catalogue national des médicaments, base unique de toutes les pharmacies ({medicaments.length}). Le prix et le taux nationaux ne sont pas modifiables ici ;
        le prix pratiqué se saisit au comptoir.{' '}
        {peutModifier
          ? 'Un médicament absent se crée avec « Nouveau médicament » ; ajoutez à votre liste ceux que vous délivrez (homologués et activés par votre assureur).'
          : 'La liste de la pharmacie est tenue par le pharmacien.'}
      </p>
      {erreur && <p className="text-sm text-destructive">{erreur}</p>}
      <DataTable
        donnees={medicaments}
        cleLigne={(m) => m.id}
        parPage={15}
        recherche={{ placeholder: 'DCI, nom commercial, classe…', champs: ['denominationCommune', 'nomCommercial', 'classeTherapeutique'] }}
        filtres={[
          {
            cle: 'statutHomologation',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_STATUT_HOMOLOGATION).filter(([valeur]) => valeur !== 'RETIRE').map(([valeur, libelle]) => ({ valeur, libelle })),
            valeur: (m) => (m as MedicamentReference).statutHomologation,
          },
          {
            cle: 'dansMaListe',
            libelle: 'Ma liste',
            options: [
              { valeur: 'oui', libelle: 'Dans ma liste' },
              { valeur: 'non', libelle: 'Pas encore ajoutés' },
            ],
            valeur: (m) => ((m as MedicamentReference).dansMaListe ? 'oui' : 'non'),
          },
        ]}
        colonnes={colonnes}
        actions={
          peutModifier ? (
            <FormulaireModal
              titre="Nouveau médicament au catalogue national"
              description="Le médicament est ajouté au catalogue national avec son prix national. Il ne sera prescrit, dispensé et remboursé qu'une fois activé par votre assureur ; un médicament existant n'est jamais modifié."
              declencheurLabel="Nouveau médicament"
              libelleSoumettre="Ajouter au catalogue"
              onSoumettre={async (fd) => {
                const texte = (k: string) => String(fd.get(k) ?? '').trim() || undefined;
                return creerMedicamentCatalogue({
                  denominationCommune: String(fd.get('denominationCommune') ?? '').trim(),
                  nomCommercial: texte('nomCommercial'),
                  dosage: texte('dosage'),
                  forme: texte('forme'),
                  classeTherapeutique: texte('classeTherapeutique'),
                  prixReferenceXof: Number(fd.get('prixReferenceXof')),
                });
              }}
              onSucces={rafraichir}
            >
              <ChampTexte name="denominationCommune" label="Dénomination commune (DCI)" required placeholder="Paracétamol" />
              <ChampTexte name="nomCommercial" label="Nom commercial" placeholder="Doliprane" />
              <ChampTexte name="dosage" label="Dosage" placeholder="500 mg" />
              <ChampTexte name="forme" label="Forme" placeholder="Comprimé" />
              <ChampTexte name="classeTherapeutique" label="Classe thérapeutique" />
              <ChampNombre name="prixReferenceXof" label="Prix national (F)" required min={0.01} step="0.01" aide="Prix de référence national du médicament." />
            </FormulaireModal>
          ) : undefined
        }
        actionLigne={
          peutModifier
            ? (m) =>
                m.dansMaListe ? (
                  <span className="flex justify-end gap-2">
                    <FormulaireModal
                      titre={`Ma liste — ${m.denominationCommune}`}
                      mode="center"
                      declencheurLabel="Modifier"
                      libelleSoumettre="Enregistrer"
                      onSoumettre={async (fd) =>
                        modifierMedicamentDeMaListe(m.id, { disponible: fd.get('disponible') === 'on', note: String(fd.get('note') ?? '') })
                      }
                      onSucces={rafraichir}
                    >
                      <ChampCheckbox name="disponible" label="Disponible dans ma pharmacie" defaultChecked={m.disponible !== false} />
                      <ChampTexte name="note" label="Note (facultatif)" defaultValue={m.note ?? ''} placeholder="Ex. rupture jusqu’au 20" />
                    </FormulaireModal>
                    <ConfirmationAction
                      action="supprimer"
                      libelles={{ titre: 'Retirer de ma liste', bouton: 'Retirer', verbe: 'retirer' }}
                      element={`le médicament « ${m.denominationCommune} » de votre liste`}
                      consequence="Il reste dans le catalogue national ; il est de nouveau réputé disponible par défaut."
                      onConfirmer={() => retirerMedicamentDeMaListe(m.id)}
                      onSucces={rafraichir}
                    />
                  </span>
                ) : !m.activee ? (
                  <span className="text-xs text-muted-foreground" title="Ajoutable à votre liste une fois homologué et activé par votre assureur.">
                    Non activé
                  </span>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={enCours}
                    onClick={() =>
                      demarrer(async () => {
                        setErreur(null);
                        const r = await ajouterMedicamentAMaListe(m.id);
                        if (r.ok) rafraichir();
                        else setErreur(r.error);
                      })
                    }
                  >
                    Ajouter à ma liste
                  </Button>
                )
            : undefined
        }
        vide="Aucun médicament dans le catalogue national pour l’instant."
      />
    </div>
  );
}
