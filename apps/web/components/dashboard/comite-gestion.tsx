'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ajouterMembreComite,
  retirerMembreComite,
} from '@/app/dashboard-assureur/informatique/souscripteurs/actions';
import {
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MembreComite {
  id: string;
  userId: string;
  fonction: string;
  dateDebutMandat: string | null;
}
interface Compte {
  id: string;
  email: string | null;
  libelleRole: string | null;
}

/**
 * Comité de gestion d'un souscripteur COLLECTIVITE (v9 §1.3) : liste des membres
 * en mandat + ajout / retrait. Chaque membre référence un compte réel de
 * l'organisation (`profils`).
 */
export function ComiteGestion({
  souscripteurId,
  membres,
  comptes,
}: {
  souscripteurId: string;
  membres: MembreComite[];
  comptes: Compte[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const emailDe = (userId: string) =>
    comptes.find((c) => c.id === userId)?.email ?? userId;

  const optionsComptes = comptes.map((c) => ({
    valeur: c.id,
    libelle: `${c.email ?? c.id}${c.libelleRole ? ` — ${c.libelleRole}` : ''}`,
  }));

  const colonnes: ColonneTable<MembreComite>[] = [
    { cle: 'membre', entete: 'Membre', rendu: (m) => emailDe(m.userId) },
    { cle: 'fonction', entete: 'Fonction', triable: true },
    {
      cle: 'dateDebutMandat',
      entete: 'Début de mandat',
      rendu: (m) =>
        m.dateDebutMandat
          ? new Date(m.dateDebutMandat).toLocaleDateString('fr-FR')
          : '—',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Comité de gestion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        <DataTable
          donnees={membres}
          cleLigne={(m) => m.id}
          parPage={0}
          colonnes={colonnes}
          actions={
            <FormulaireModal
              titre="Ajouter un membre au comité"
              description="Le membre doit avoir un compte dans l’organisation."
              declencheurLabel="Ajouter un membre"
              mode="center"
              libelleSoumettre="Ajouter"
              onSoumettre={async (fd) =>
                ajouterMembreComite(souscripteurId, {
                  userId: String(fd.get('userId') ?? ''),
                  fonction: String(fd.get('fonction') ?? ''),
                  dateDebutMandat:
                    String(fd.get('dateDebutMandat') ?? '') || undefined,
                })
              }
              onSucces={() => router.refresh()}
            >
              {optionsComptes.length > 0 ? (
                <ChampSelect
                  name="userId"
                  label="Compte"
                  required
                  placeholder="Choisir un compte…"
                  options={optionsComptes}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucun compte disponible dans l’organisation. Invitez d’abord un
                  utilisateur.
                </p>
              )}
              <ChampTexte
                name="fonction"
                label="Fonction"
                required
                placeholder="Président, Trésorier, Secrétaire…"
              />
              <ChampTexte
                name="dateDebutMandat"
                label="Début de mandat"
                type="date"
              />
            </FormulaireModal>
          }
          actionLigne={(m) => (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setErreur(null);
                start(async () => {
                  const r = await retirerMembreComite(souscripteurId, m.id);
                  if (!r.ok) setErreur(r.error);
                  else router.refresh();
                });
              }}
            >
              Retirer
            </Button>
          )}
          vide="Aucun membre dans le comité."
        />
      </CardContent>
    </Card>
  );
}
