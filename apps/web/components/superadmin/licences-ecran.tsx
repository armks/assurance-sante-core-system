'use client';

import { BellRing, Building2, KeyRound, Mail, UserRound, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { activerDirectement, definirEmailSociete, envoyerAlerteExpiration, envoyerCodeParEmail, genererCodeActivation, type ResultatLicence } from '@/app/superadmin/licences/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface LicenceSociete {
  organisationId: string;
  nom: string;
  statutOrganisation: string;
  etat: 'ACTIVE' | 'EXPIREE' | 'EN_ATTENTE_ACTIVATION' | 'SUSPENDUE' | 'ABSENTE';
  typeLicence: string | null;
  libelleType: string | null;
  dateDebut: string | null;
  dateFin: string | null;
  joursRestants: number | null;
  bientotExpiree: boolean;
  codeEnAttente: { typeLicence: string; expireLe: string } | null;
  /** adresse e-mail enregistrée pour la société d'assurance (destinataire possible du code) */
  emailSociete: string | null;
  nbDirecteurs: number;
  derniereActivation: { typeLicence: string; le: string } | null;
}
export interface TypeLicenceOption {
  valeur: string;
  libelle: string;
  duree: string;
  prix?: number;
}

const dateFr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const ETAT: Record<LicenceSociete['etat'], { libelle: string; classe: string }> = {
  ACTIVE: { libelle: 'Active', classe: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400' },
  EXPIREE: { libelle: 'Expirée', classe: 'border-destructive/40 bg-destructive/10 text-destructive' },
  EN_ATTENTE_ACTIVATION: { libelle: 'En attente d’activation', classe: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300' },
  SUSPENDUE: { libelle: 'Suspendue', classe: 'border-destructive/40 bg-destructive/10 text-destructive' },
  ABSENTE: { libelle: 'Aucune licence', classe: 'border-border bg-muted text-muted-foreground' },
};

function LigneSociete({ s, types }: { s: LicenceSociete; types: TypeLicenceOption[] }) {
  const router = useRouter();
  const [type, setType] = useState('ANNUELLE');
  const [pending, startTransition] = useTransition();
  const [retour, setRetour] = useState<ResultatLicence | null>(null);
  const [email, setEmail] = useState(s.emailSociete ?? '');
  const etat = ETAT[s.etat];

  function lancer(action: () => Promise<ResultatLicence>, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;
    setRetour(null);
    startTransition(async () => {
      const res = await action();
      setRetour(res);
      if (res.ok) router.refresh();
    });
  }
  const libelleType = types.find((t) => t.valeur === type)?.libelle ?? type;

  return (
    <li className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{s.nom}</h2>
        <Badge variant="outline" className={etat.classe}>
          {etat.libelle}
        </Badge>
        {s.libelleType && <Badge variant="secondary">{s.libelleType}</Badge>}
        {s.statutOrganisation !== 'ACTIVE' && <Badge variant="outline">Société {s.statutOrganisation.toLowerCase()}</Badge>}
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Début</dt>
          <dd>{dateFr(s.dateDebut)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Expiration</dt>
          <dd className="font-medium">{dateFr(s.dateFin)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Temps restant</dt>
          <dd className={s.joursRestants !== null && s.joursRestants <= 7 ? 'font-semibold text-destructive' : s.bientotExpiree ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>
            {s.joursRestants === null ? 'Sans échéance' : s.joursRestants < 0 ? `Expirée depuis ${-s.joursRestants} j` : `${s.joursRestants} jour${s.joursRestants > 1 ? 's' : ''}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Code d’activation en attente</dt>
          <dd>{s.codeEnAttente ? `${s.codeEnAttente.typeLicence.toLowerCase()} — expire le ${new Date(s.codeEnAttente.expireLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Aucun'}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          Licence à activer
          <select value={type} onChange={(e) => setType(e.target.value)} className="block h-9 min-w-56 rounded-md border border-input bg-transparent px-2 text-sm" aria-label={`Type de licence pour ${s.nom}`}>
            {types.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.libelle} — {t.duree}{t.prix !== undefined ? ` — ${t.prix.toLocaleString('fr-FR')} F` : ''}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => lancer(() => genererCodeActivation(s.organisationId, type))} title="Génère un code temporaire (24 h), reçu par e-mail">
          <KeyRound className="size-4" aria-hidden="true" /> Générer le code
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => lancer(() => activerDirectement(s.organisationId, type), `Activer directement « ${libelleType} » pour ${s.nom}, sans code d’activation ?`)}
          title="Active la société tout de suite, sans passer par le code"
        >
          <Zap className="size-4" aria-hidden="true" /> Activer directement
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => lancer(() => envoyerAlerteExpiration(s.organisationId), `Envoyer l’alerte d’expiration aux administrateurs de ${s.nom} ?`)}>
          <BellRing className="size-4" aria-hidden="true" /> Alerte d’expiration
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Mail className="size-4" aria-hidden="true" /> Envoyer le code d’activation par e-mail
          {!s.codeEnAttente && <span className="font-normal">— générez d’abord un code (valable 24 h)</span>}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 space-y-1 text-xs text-muted-foreground">
            E-mail de la société d’assurance
            <span className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@societe-assurance.ci"
                autoComplete="off"
                className="block h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                aria-label={`E-mail de ${s.nom}`}
              />
              <Button size="sm" variant="outline" disabled={pending || !email.trim() || email.trim().toLowerCase() === (s.emailSociete ?? '')} onClick={() => lancer(() => definirEmailSociete(s.organisationId, email))}>
                Enregistrer
              </Button>
            </span>
          </label>
          <Button
            size="sm"
            disabled={pending || !s.codeEnAttente || !s.emailSociete}
            onClick={() => lancer(() => envoyerCodeParEmail(s.organisationId, 'SOCIETE'))}
            title={!s.codeEnAttente ? 'Aucun code valide : générez-en un' : !s.emailSociete ? 'Enregistrez d’abord l’e-mail de la société' : `Envoyer le code à ${s.emailSociete}`}
          >
            <Building2 className="size-4" aria-hidden="true" /> Envoyer à la société
          </Button>
          <Button
            size="sm"
            disabled={pending || !s.codeEnAttente || s.nbDirecteurs === 0}
            onClick={() => lancer(() => envoyerCodeParEmail(s.organisationId, 'DIRECTEUR'))}
            title={!s.codeEnAttente ? 'Aucun code valide : générez-en un' : s.nbDirecteurs === 0 ? 'Aucun directeur enregistré dans cette société' : `Envoyer le code au directeur (${s.nbDirecteurs} compte${s.nbDirecteurs > 1 ? 's' : ''})`}
          >
            <UserRound className="size-4" aria-hidden="true" /> Envoyer au directeur
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="text-sm">
        {retour && !retour.ok && <p className="text-destructive">{retour.error}</p>}
        {retour?.ok && <p className="text-emerald-700 dark:text-emerald-400">{retour.message}</p>}
        {retour?.ok && retour.code && (
          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-lg tracking-widest text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200" data-testid="code-affiche">
            {retour.code}
          </p>
        )}
      </div>
      {s.derniereActivation && (
        <p className="text-xs text-muted-foreground">
          Dernière activation : {s.derniereActivation.typeLicence.toLowerCase()} le {new Date(s.derniereActivation.le).toLocaleDateString('fr-FR')}.
        </p>
      )}
    </li>
  );
}

/** Panneau du superadmin : état des licences de toutes les sociétés, code d'activation, activation directe, alerte d'expiration. */
export function LicencesEcran({ licences, types }: { licences: LicenceSociete[]; types: TypeLicenceOption[] }) {
  return (
    <ul className="space-y-4">
      {licences.map((s) => (
        <LigneSociete key={s.organisationId} s={s} types={types} />
      ))}
      {licences.length === 0 && <li className="text-sm text-muted-foreground">Aucune société.</li>}
    </ul>
  );
}
