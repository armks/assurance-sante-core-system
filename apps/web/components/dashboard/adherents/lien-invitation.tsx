'use client';

import { Copy } from 'lucide-react';
import { useState } from 'react';

import { inviterAdherent } from '@/app/dashboard-societe/propositions-membres-actions';
import { Alerte, ChampTexte, FormulaireModal } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export interface LienInvitation {
  /** Chemin relatif renvoyé par l'API (`/accepter-invitation/<jeton>`). */
  chemin: string;
  email: string;
  emailEnvoye: boolean | null;
}

/** Lien complet à transmettre à l'adhérent (l'origine est connue du navigateur seulement). */
const lienComplet = (chemin: string) => `${typeof window === 'undefined' ? '' : window.location.origin}${chemin}`;

/** Génère le lien d'invitation d'un adhérent ; l'API contrôle rôle, périmètre, statut et compte existant. */
export async function genererLienInvitation(
  adherentId: string,
  email: string,
): Promise<{ ok: true; lien: LienInvitation } | { ok: false; error: string }> {
  const mail = email.trim();
  if (!mail) return { ok: false, error: 'Renseignez l’e-mail de l’adhérent : le lien d’invitation est lié à cette adresse.' };
  const r = await inviterAdherent(adherentId, mail);
  if (!r.ok) return r;
  return { ok: true, lien: { chemin: `/accepter-invitation/${r.token}`, email: mail, emailEnvoye: r.emailEnvoye } };
}

/** Bandeau affichant le lien généré, avec copie dans le presse-papiers. */
export function BandeauLienInvitation({ lien, onFermer }: { lien: LienInvitation; onFermer?: () => void }) {
  const [copie, setCopie] = useState<string | null>(null);
  const url = lienComplet(lien.chemin);
  const copier = () =>
    navigator.clipboard.writeText(url).then(
      () => setCopie('Lien copié.'),
      () => setCopie('Copie automatique impossible : sélectionnez le lien ci-dessus.'),
    );
  return (
    <Alerte ton="succes" titre="Lien d’invitation généré">
      <div className="space-y-2">
        <p>
          À transmettre à l’adhérent ({lien.email}) pour qu’il crée son profil. Le lien expire ; il n’est affiché qu’ici.
          {lien.emailEnvoye === true && ' Un e-mail lui a aussi été envoyé.'}
          {lien.emailEnvoye === false && ' L’envoi par e-mail n’a pas abouti : transmettez le lien vous-même.'}
        </p>
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Lien d’invitation" className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" variant="outline" onClick={copier}>
            <Copy className="size-3" /> Copier le lien
          </Button>
          {onFermer && (
            <Button type="button" size="xs" variant="ghost" onClick={onFermer}>
              Fermer
            </Button>
          )}
          {copie && <span className="text-xs text-muted-foreground">{copie}</span>}
        </div>
      </div>
    </Alerte>
  );
}

/**
 * Bouton « Générer le lien d'invitation » de la fiche d'un adhérent : l'adhérent crée son profil et accède à sa page profil.
 * Si la fiche porte déjà un e-mail, c'est celui-là (l'API l'exige) ; sinon la personne qui invite le saisit.
 */
export function BoutonLienInvitation({ adherentId, emailFiche, nom }: { adherentId: string; emailFiche?: string | null; nom: string }) {
  const [lien, setLien] = useState<LienInvitation | null>(null);
  return (
    <div className="space-y-3">
      <FormulaireModal
        titre="Générer le lien d’invitation"
        mode="center"
        description={`${nom} pourra créer son profil et accéder à sa page adhérent grâce à ce lien.`}
        declencheur={<Button size="sm" variant="outline">Générer le lien d’invitation</Button>}
        libelleSoumettre="Générer le lien"
        onSoumettre={async (fd) => {
          const r = await genererLienInvitation(adherentId, String(fd.get('email') ?? ''));
          if (!r.ok) return { ok: false, error: r.error };
          setLien(r.lien);
          return { ok: true };
        }}
      >
        <ChampTexte
          name="email"
          label="E-mail de l’adhérent"
          type="email"
          required
          maxLength={200}
          defaultValue={emailFiche ?? ''}
          readOnly={!!emailFiche}
          aide={emailFiche ? 'Adresse enregistrée sur la fiche.' : 'Adresse à laquelle le lien est lié.'}
        />
      </FormulaireModal>
      {lien && <BandeauLienInvitation lien={lien} onFermer={() => setLien(null)} />}
    </div>
  );
}

/**
 * Bouton « Lien d'invitation » d'une ligne de la liste : une seule fenêtre, qui affiche d'abord l'e-mail puis, une fois le lien généré,
 * le lien à copier (la ligne d'un tableau n'a pas la place d'un bandeau).
 */
export function BoutonLienInvitationListe({ adherentId, emailFiche, nom }: { adherentId: string; emailFiche?: string | null; nom: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [email, setEmail] = useState(emailFiche ?? '');
  const [lien, setLien] = useState<LienInvitation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const generer = async () => {
    setPending(true);
    setErreur(null);
    const r = await genererLienInvitation(adherentId, email);
    setPending(false);
    if (r.ok) setLien(r.lien);
    else setErreur(r.error);
  };

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(v) => {
        setOuvert(v);
        if (!v) {
          setLien(null);
          setErreur(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="xs" variant="ghost" title={`Lien pour que ${nom} crée son profil`}>
          Lien d’invitation
        </Button>
      </DialogTrigger>
      <DialogContent side="center">
        <DialogHeader>
          <DialogTitle>Lien d’invitation — {nom}</DialogTitle>
          <DialogDescription>L’adhérent crée son profil avec ce lien et accède à sa page adhérent.</DialogDescription>
        </DialogHeader>
        {lien ? (
          <BandeauLienInvitation lien={lien} />
        ) : (
          <div className="grid gap-4">
            <ChampTexte
              name="email"
              label="E-mail de l’adhérent"
              type="email"
              required
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={!!emailFiche}
              aide={emailFiche ? 'Adresse enregistrée sur la fiche.' : 'Adresse à laquelle le lien est lié.'}
            />
            {erreur && (
              <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {erreur}
              </div>
            )}
            <Button type="button" onClick={generer} disabled={pending}>
              {pending ? 'Génération…' : 'Générer le lien'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
