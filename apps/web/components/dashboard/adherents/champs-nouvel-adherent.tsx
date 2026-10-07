'use client';

import { useState } from 'react';

import {
  ChampSelect,
  ChampTexte,
} from '@/components/dashboard/patterns';
import { MODES_PAIEMENT, SEXES } from '@/lib/member';
import type { OptionRef, PoliceRef } from './types';
import { LIBELLE_POLICE } from '@/lib/police';

/**
 * Champs du formulaire « Nouvel adhérent ». Le choix du souscripteur filtre la
 * liste des polices. `souscripteurVerrou` : société qui ne gère que ses propres
 * adhérents — souscripteur imposé.
 */
export function ChampsNouvelAdherent({
  souscripteurs,
  polices,
  souscripteurVerrou,
}: {
  souscripteurs: OptionRef[];
  polices: PoliceRef[];
  souscripteurVerrou?: string;
}) {
  const [souscripteurId, setSouscripteurId] = useState(
    souscripteurVerrou ?? souscripteurs[0]?.id ?? '',
  );
  const policesDuSouscripteur = polices.filter(
    (p) => p.souscripteurId === souscripteurId,
  );

  return (
    <>
      {souscripteurVerrou ? (
        <input type="hidden" name="souscripteurId" value={souscripteurVerrou} />
      ) : (
        <ChampSelect
          name="souscripteurId"
          label="Souscripteur"
          required
          value={souscripteurId}
          onChange={(e) => setSouscripteurId(e.target.value)}
          options={souscripteurs.map((s) => ({ valeur: s.id, libelle: s.nom }))}
        />
      )}

      <ChampSelect
        name="policeId"
        label="Police"
        placeholder={
          policesDuSouscripteur.length > 0
            ? 'Choisir une police (optionnel)'
            : 'Aucune police pour ce souscripteur'
        }
        options={policesDuSouscripteur.map((p) => ({
          valeur: p.id,
          libelle: `${p.numeroPolice} · ${
            p.produit ? `${p.produit.nom} v${p.produit.version}` : '—'
          } (${LIBELLE_POLICE[p.statut] ?? p.statut})`,
        }))}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="nom" label="Nom" required maxLength={120} />
        <ChampTexte name="prenom" label="Prénom" required maxLength={120} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte
          name="dateNaissance"
          label="Date de naissance"
          type="date"
          required
        />
        <ChampSelect
          name="sexe"
          label="Sexe"
          required
          placeholder="Choisir…"
          options={SEXES}
        />
      </div>
      <ChampSelect
        name="modePaiementPrefere"
        label="Mode de paiement préféré"
        placeholder="Non renseigné"
        options={MODES_PAIEMENT}
      />
    </>
  );
}
