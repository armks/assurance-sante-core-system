'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Minus, Paperclip, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  LONGUEUR_MAX_MESSAGE,
  TAILLE_MAX_FICHIER,
  type ContactMessagerie,
  type ConversationMessagerie,
  type MessageMessagerie,
} from '@/lib/messagerie';
import { cn } from '@/lib/utils';

const heure = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const jour = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
const taille = (o: number | null) => (o === null ? '' : o >= 1024 * 1024 ? `${(o / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

export interface FenetreProps {
  /** Conversation existante, ou `null` pour un brouillon (premier message = invitation). */
  conversation: ConversationMessagerie | null;
  contact: ContactMessagerie;
  messages: MessageMessagerie[];
  reduite: boolean;
  ecrit: boolean;
  onReduire: () => void;
  onFermer: () => void;
  onEnvoyer: (contenu: string) => Promise<string | null>;
  onFichier: (fichier: File, legende: string) => Promise<string | null>;
  onAccepter: () => Promise<string | null>;
  onRefuser: () => Promise<string | null>;
  onSaisie: () => void;
}

/** Fenêtre de discussion (style messagerie instantanée) : en-tête réductible, messages, saisie, pièce jointe, invitation. */
export function FenetreChat({ conversation, contact, messages, reduite, ecrit, onReduire, onFermer, onEnvoyer, onFichier, onAccepter, onRefuser, onSaisie }: FenetreProps) {
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const dernierSaisie = useRef(0);
  const fichierInput = useRef<HTMLInputElement>(null);
  const nonLus = conversation?.nonLus ?? 0;
  const statut = conversation?.statut ?? 'BROUILLON';
  const moi = (m: MessageMessagerie) => m.expediteurId !== contact.id;
  const peutEcrire = statut === 'ACTIVE' || statut === 'BROUILLON';

  useEffect(() => {
    if (!reduite) fin.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, reduite, ecrit]);

  async function envoyer() {
    const t = texte.trim();
    if (!t || envoi) return;
    setEnvoi(true);
    setErreur(null);
    const e = await onEnvoyer(t);
    setEnvoi(false);
    if (e) setErreur(e);
    else setTexte('');
  }

  async function choisirFichier(f: File | undefined) {
    if (!f) return;
    if (f.size > TAILLE_MAX_FICHIER) {
      setErreur('Fichier trop volumineux (5 Mo maximum).');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    const e = await onFichier(f, texte.trim());
    setEnvoi(false);
    if (e) setErreur(e);
    else setTexte('');
    if (fichierInput.current) fichierInput.current.value = '';
  }

  return (
    <section
      aria-label={`Discussion avec ${contact.nom}`}
      className={cn(
        'pointer-events-auto flex flex-col overflow-hidden rounded-t-lg border bg-card text-card-foreground shadow-xl',
        reduite ? 'h-11 w-56' : 'h-[26rem] w-80 max-sm:fixed max-sm:inset-0 max-sm:z-[60] max-sm:h-auto max-sm:w-auto max-sm:rounded-none',
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-primary px-3 text-primary-foreground">
        <button type="button" onClick={onReduire} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={reduite ? `Agrandir la discussion avec ${contact.nom}` : `Réduire la discussion avec ${contact.nom}`}>
          <span className={cn('size-2 shrink-0 rounded-full', contact.enLigne ? 'bg-emerald-400' : 'bg-primary-foreground/40')} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">{contact.nom}</span>
            {!reduite && <span className="block truncate text-[11px] leading-tight opacity-80">{[contact.libelleRole, contact.lieu].filter(Boolean).join(' — ')}</span>}
          </span>
          {reduite && nonLus > 0 && <span className="ml-auto rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{nonLus}</span>}
        </button>
        <button type="button" onClick={onReduire} className="rounded p-1 hover:bg-primary-foreground/15" aria-label={reduite ? 'Agrandir' : 'Réduire'}>
          <Minus className="size-4" />
        </button>
        <button type="button" onClick={onFermer} className="rounded p-1 hover:bg-primary-foreground/15" aria-label="Fermer la discussion">
          <X className="size-4" />
        </button>
      </header>

      {!reduite && (
        <>
          <div role="log" aria-live="polite" className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
            {messages.length === 0 && statut === 'BROUILLON' && (
              <p className="pt-6 text-center text-xs text-muted-foreground">
                Votre premier message sera envoyé comme <strong>invitation</strong> : {contact.nom} doit l’accepter pour que la discussion commence.
              </p>
            )}
            {messages.map((m, i) => {
              const mien = moi(m);
              const nouveauJour = i === 0 || jour(messages[i - 1].createdAt) !== jour(m.createdAt);
              return (
                <div key={m.id}>
                  {nouveauJour && <p className="py-1 text-center text-[10px] uppercase text-muted-foreground">{jour(m.createdAt)}</p>}
                  <div className={cn('flex', mien ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[85%] rounded-2xl px-3 py-1.5 text-sm', mien ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted')}>
                      {m.fichier && (
                        <a
                          href={`/api/messagerie/conversations/${m.conversationId}/messages/${m.id}/fichier`}
                          className="mb-0.5 flex items-center gap-1.5 break-all underline underline-offset-2"
                        >
                          <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
                          <span>{m.fichier.nom}</span>
                          <span className="shrink-0 text-[10px] opacity-75">{taille(m.fichier.taille)}</span>
                        </a>
                      )}
                      {m.contenu && <p className="whitespace-pre-wrap break-words">{m.contenu}</p>}
                      <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', mien ? 'opacity-70' : 'text-muted-foreground')}>
                        {heure(m.createdAt)}
                        {mien && m.luLe && <Check className="size-3" aria-label="Lu" />}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {ecrit && <p className="px-1 text-xs italic text-muted-foreground">{contact.nom} est en train d’écrire…</p>}
            <div ref={fin} />
          </div>

          {statut === 'INVITATION' && conversation && !conversation.initieParMoi && (
            <div className="shrink-0 space-y-2 border-t bg-muted/50 p-3 text-sm">
              <p><strong>{contact.nom}</strong> vous invite à discuter.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={async () => setErreur(await onAccepter())}>Accepter</Button>
                <Button size="sm" variant="outline" onClick={async () => setErreur(await onRefuser())}>Refuser</Button>
              </div>
              {erreur && <p role="alert" className="text-xs text-destructive">{erreur}</p>}
            </div>
          )}
          {statut === 'INVITATION' && conversation?.initieParMoi && (
            <p className="shrink-0 border-t bg-muted/50 p-3 text-center text-xs text-muted-foreground">En attente de l’acceptation de {contact.nom}…</p>
          )}
          {statut === 'REFUSEE' && <p className="shrink-0 border-t bg-muted/50 p-3 text-center text-xs text-muted-foreground">Invitation refusée : la discussion est fermée jusqu’au mois prochain.</p>}

          {peutEcrire && (
            <div className="shrink-0 border-t p-2">
              {erreur && <p role="alert" className="mb-1 text-xs text-destructive">{erreur}</p>}
              <div className="flex items-end gap-1.5">
                {statut === 'ACTIVE' && (
                  <>
                    <input ref={fichierInput} type="file" className="hidden" onChange={(e) => void choisirFichier(e.target.files?.[0])} accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" />
                    <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => fichierInput.current?.click()} disabled={envoi} aria-label="Joindre un fichier (5 Mo maximum)" title="Joindre un fichier (5 Mo maximum)">
                      <Paperclip className="size-4" />
                    </Button>
                  </>
                )}
                <textarea
                  value={texte}
                  onChange={(e) => {
                    setTexte(e.target.value);
                    const t = Date.now();
                    if (statut === 'ACTIVE' && t - dernierSaisie.current > 2500) {
                      dernierSaisie.current = t;
                      onSaisie();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void envoyer();
                    }
                  }}
                  rows={1}
                  maxLength={LONGUEUR_MAX_MESSAGE}
                  placeholder={statut === 'BROUILLON' ? 'Votre message d’invitation…' : 'Votre message…'}
                  aria-label="Votre message"
                  className="max-h-24 min-h-8 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="button" size="icon" className="size-8 shrink-0" onClick={() => void envoyer()} disabled={envoi || !texte.trim()} aria-label="Envoyer">
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
