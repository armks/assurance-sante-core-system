'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Plus, Search, Volume2, VolumeX, X } from 'lucide-react';

import { FenetreChat } from '@/components/messagerie/fenetre-chat';
import {
  type ContactMessagerie,
  type ConversationMessagerie,
  type MessageMessagerie,
} from '@/lib/messagerie';
import { cn } from '@/lib/utils';

const RACINE = '/api/messagerie';
const MAX_FENETRES = 3;

interface Fenetre {
  /** Identifiant de conversation, ou `nouveau:<idContact>` pour un brouillon (premier message = invitation). */
  cle: string;
  reduite: boolean;
  contact: ContactMessagerie;
}

type Resultat<T> = { ok: true; data: T } | { ok: false; erreur: string };

async function appel<T>(chemin: string, init?: RequestInit): Promise<Resultat<T>> {
  try {
    const res = await fetch(`${RACINE}/${chemin}`, { ...init, cache: 'no-store' });
    const corps = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const m = (corps as { message?: string | string[] } | null)?.message;
      return { ok: false, erreur: Array.isArray(m) ? m.join(' ') : (m ?? `Erreur (${res.status}).`) };
    }
    return { ok: true, data: corps as T };
  } catch {
    return { ok: false, erreur: 'Connexion impossible. Réessayez.' };
  }
}

const post = (chemin: string, corps?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(corps ?? {}),
});

function bip() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start();
    o.stop(ctx.currentTime + 0.25);
    o.onended = () => void ctx.close();
  } catch {
    // son indisponible (navigateur sans interaction préalable) : sans importance
  }
}

/**
 * Messagerie interne instantanée : bulle en bas à droite, liste des discussions, fenêtres réductibles (comme Facebook), notification
 * d'un message reçu pendant la connexion. Temps réel par flux SSE ; les règles « qui peut écrire à qui » sont appliquées par le serveur.
 */
export function MessagerieFlottante() {
  const [convs, setConvs] = useState<ConversationMessagerie[]>([]);
  const [fenetres, setFenetres] = useState<Fenetre[]>([]);
  const [messages, setMessages] = useState<Record<string, MessageMessagerie[]>>({});
  const [ecrit, setEcrit] = useState<Record<string, number>>({});
  const [panneau, setPanneau] = useState(false);
  const [annuaireOuvert, setAnnuaireOuvert] = useState(false);
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<ContactMessagerie[]>([]);
  const [erreurPanneau, setErreurPanneau] = useState<string | null>(null);
  const [son, setSon] = useState(true);
  const [, tic] = useState(0);
  const convsRef = useRef<ConversationMessagerie[]>([]);
  const fenetresRef = useRef<Fenetre[]>([]);
  const messagesRef = useRef<Record<string, MessageMessagerie[]>>({});
  const sonRef = useRef(true);
  convsRef.current = convs;
  fenetresRef.current = fenetres;
  messagesRef.current = messages;
  sonRef.current = son;

  useEffect(() => {
    try {
      setSon(localStorage.getItem('messagerie-son') !== 'off');
    } catch {
      // stockage indisponible : son activé
    }
  }, []);

  const rafraichir = useCallback(async () => {
    const r = await appel<ConversationMessagerie[]>('conversations');
    if (r.ok) {
      setConvs(r.data);
      convsRef.current = r.data;
      // les contacts affichés dans les fenêtres suivent la présence / le statut à jour
      setFenetres((f) => f.map((w) => ({ ...w, contact: r.data.find((c) => c.id === w.cle)?.interlocuteur ?? w.contact })));
      return r.data;
    }
    return convsRef.current;
  }, []);

  const chargerMessages = useCallback(async (id: string) => {
    const r = await appel<MessageMessagerie[]>(`conversations/${id}/messages`);
    if (r.ok) setMessages((m) => ({ ...m, [id]: r.data }));
  }, []);

  const marquerLu = useCallback(
    async (id: string) => {
      await appel(`conversations/${id}/lu`, post(`conversations/${id}/lu`));
      setConvs((l) => l.map((c) => (c.id === id ? { ...c, nonLus: 0 } : c)));
    },
    [],
  );

  const ouvrir = useCallback(
    (c: { cle: string; contact: ContactMessagerie; reduite?: boolean }) => {
      setFenetres((f) => {
        const existante = f.find((w) => w.cle === c.cle);
        if (existante) return f.map((w) => (w.cle === c.cle ? { ...w, reduite: c.reduite ?? false, contact: c.contact } : w));
        return [...f, { cle: c.cle, contact: c.contact, reduite: c.reduite ?? false }].slice(-MAX_FENETRES);
      });
      if (!c.cle.startsWith('nouveau:')) {
        void chargerMessages(c.cle);
        if (!c.reduite) void marquerLu(c.cle);
      }
    },
    [chargerMessages, marquerLu],
  );

  // chargement initial
  useEffect(() => {
    void rafraichir();
  }, [rafraichir]);

  // flux temps réel
  useEffect(() => {
    const flux = new EventSource(`${RACINE}/flux`);
    flux.onmessage = async (e) => {
      let ev: { type: string; conversationId?: string; message?: MessageMessagerie };
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.type === 'ping' || ev.type === 'pret') return;
      if (ev.type === 'purge') {
        setMessages({});
        setFenetres([]);
        setConvs([]);
        return;
      }
      const id = ev.conversationId;
      if (ev.type === 'saisie' && id) {
        setEcrit((s) => ({ ...s, [id]: Date.now() }));
        return;
      }
      const liste = await rafraichir();
      const conv = liste.find((c) => c.id === id);
      if (!conv || !id) return;
      if ((ev.type === 'message' || ev.type === 'invitation') && ev.message) {
        const msg = ev.message;
        setMessages((m) => {
          const actuels = m[id];
          if (!actuels) return m; // historique pas encore chargé : il le sera à l'ouverture
          return actuels.some((x) => x.id === msg.id) ? m : { ...m, [id]: [...actuels, msg] };
        });
        setEcrit((s) => ({ ...s, [id]: 0 }));
        const recu = msg.expediteurId === conv.interlocuteur.id;
        if (recu) {
          if (sonRef.current) bip();
          const f = fenetresRef.current.find((w) => w.cle === id);
          if (!f) {
            // message reçu : la fenêtre s'ouvre dans l'angle (réductible)
            ouvrir({ cle: id, contact: conv.interlocuteur, reduite: document.visibilityState !== 'visible' });
          } else if (!f.reduite && document.visibilityState === 'visible') {
            void marquerLu(id);
          }
        }
      } else if (ev.type === 'accepte' || ev.type === 'refuse') {
        void chargerMessages(id);
      } else if (ev.type === 'lu') {
        setMessages((m) => (m[id] ? { ...m, [id]: m[id].map((x) => (x.expediteurId !== conv.interlocuteur.id && !x.luLe ? { ...x, luLe: new Date().toISOString() } : x)) } : m));
      }
    };
    return () => flux.close();
  }, [rafraichir, ouvrir, marquerLu, chargerMessages]);

  // actualise l'indicateur « écrit… » (disparaît après 4 s) et la présence (toutes les minutes)
  useEffect(() => {
    const a = setInterval(() => tic((n) => n + 1), 2000);
    const b = setInterval(() => void rafraichir(), 60_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [rafraichir]);

  // annuaire (recherche d'une personne à qui écrire)
  useEffect(() => {
    if (!annuaireOuvert) return;
    const t = setTimeout(async () => {
      const r = await appel<ContactMessagerie[]>(`annuaire${q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
      if (r.ok) {
        setContacts(r.data);
        setErreurPanneau(null);
      } else setErreurPanneau(r.erreur);
    }, 250);
    return () => clearTimeout(t);
  }, [annuaireOuvert, q]);

  const totalNonLus = convs.filter((c) => c.statut !== 'REFUSEE').reduce((s, c) => s + c.nonLus, 0);

  function basculerSon() {
    const n = !son;
    setSon(n);
    try {
      localStorage.setItem('messagerie-son', n ? 'on' : 'off');
    } catch {
      // préférence non mémorisée
    }
  }

  function ouvrirContact(c: ContactMessagerie) {
    setPanneau(false);
    setAnnuaireOuvert(false);
    setQ('');
    if (c.conversationId) {
      const conv = convs.find((x) => x.id === c.conversationId);
      ouvrir({ cle: c.conversationId, contact: conv?.interlocuteur ?? c });
    } else {
      ouvrir({ cle: `nouveau:${c.id}`, contact: c });
    }
  }

  function reduire(cle: string) {
    const f = fenetres.find((w) => w.cle === cle);
    if (!f) return;
    const reduite = !f.reduite;
    setFenetres((l) => l.map((w) => (w.cle === cle ? { ...w, reduite } : w)));
    if (!reduite && !cle.startsWith('nouveau:')) void marquerLu(cle);
  }

  const fermer = (cle: string) => setFenetres((l) => l.filter((w) => w.cle !== cle));

  async function envoyer(f: Fenetre, contenu: string): Promise<string | null> {
    if (f.cle.startsWith('nouveau:')) {
      const r = await appel<{ conversationId: string }>('conversations', post('conversations', { destinataireId: f.contact.id, contenu }));
      if (!r.ok) return r.erreur;
      const liste = await rafraichir();
      const conv = liste.find((c) => c.id === r.data.conversationId);
      await chargerMessages(r.data.conversationId);
      setFenetres((l) => l.map((w) => (w.cle === f.cle ? { ...w, cle: r.data.conversationId, contact: conv?.interlocuteur ?? w.contact } : w)));
      return null;
    }
    const r = await appel(`conversations/${f.cle}/messages`, post(`conversations/${f.cle}/messages`, { contenu }));
    return r.ok ? null : r.erreur;
  }

  async function envoyerFichier(f: Fenetre, fichier: File, legende: string): Promise<string | null> {
    const fd = new FormData();
    fd.set('fichier', fichier);
    if (legende) fd.set('contenu', legende);
    const r = await appel(`conversations/${f.cle}/fichiers`, { method: 'POST', body: fd });
    return r.ok ? null : r.erreur;
  }

  async function decider(f: Fenetre, action: 'accepter' | 'refuser'): Promise<string | null> {
    const r = await appel(`conversations/${f.cle}/${action}`, post(`conversations/${f.cle}/${action}`));
    if (!r.ok) return r.erreur;
    await rafraichir();
    await chargerMessages(f.cle);
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 print:hidden" data-testid="messagerie-flottante">
      {/* fenêtres de discussion, à gauche de la bulle */}
      <div className="absolute bottom-0 right-20 flex items-end gap-3 max-sm:right-0">
        {fenetres.map((f) => {
          const conv = convs.find((c) => c.id === f.cle) ?? null;
          return (
            <FenetreChat
              key={f.cle}
              conversation={conv}
              contact={conv?.interlocuteur ?? f.contact}
              messages={messages[f.cle] ?? []}
              reduite={f.reduite}
              ecrit={Date.now() - (ecrit[f.cle] ?? 0) < 4000}
              onReduire={() => reduire(f.cle)}
              onFermer={() => fermer(f.cle)}
              onEnvoyer={(c) => envoyer(f, c)}
              onFichier={(fi, l) => envoyerFichier(f, fi, l)}
              onAccepter={() => decider(f, 'accepter')}
              onRefuser={() => decider(f, 'refuser')}
              onSaisie={() => void appel(`conversations/${f.cle}/saisie`, post(`conversations/${f.cle}/saisie`))}
            />
          );
        })}
      </div>

      {/* liste des discussions */}
      {panneau && (
        <div className="pointer-events-auto absolute bottom-20 right-4 flex max-h-[28rem] w-80 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl max-sm:inset-x-2 max-sm:w-auto">
          <div className="flex items-center gap-1 border-b px-3 py-2">
            <h2 className="flex-1 text-sm font-semibold">{annuaireOuvert ? 'Nouvelle discussion' : 'Discussions'}</h2>
            <button type="button" onClick={basculerSon} className="rounded p-1 hover:bg-muted" aria-label={son ? 'Désactiver le son des messages' : 'Activer le son des messages'}>
              {son ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setAnnuaireOuvert((o) => !o);
                setQ('');
              }}
              className="rounded p-1 hover:bg-muted"
              aria-label={annuaireOuvert ? 'Retour aux discussions' : 'Nouvelle discussion'}
              title={annuaireOuvert ? 'Retour aux discussions' : 'Nouvelle discussion'}
            >
              {annuaireOuvert ? <X className="size-4" /> : <Plus className="size-4" />}
            </button>
          </div>
          {annuaireOuvert ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <label className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher une personne…"
                  aria-label="Rechercher une personne"
                  maxLength={60}
                  className="w-full bg-transparent text-sm outline-none"
                />
              </label>
              <ul className="flex-1 overflow-y-auto">
                {erreurPanneau && <li className="px-3 py-3 text-sm text-destructive">{erreurPanneau}</li>}
                {!erreurPanneau && contacts.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">Aucune personne trouvée.</li>}
                {contacts.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => ouvrirContact(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
                      <span className={cn('size-2 shrink-0 rounded-full', c.enLigne ? 'bg-emerald-500' : 'bg-muted-foreground/30')} aria-label={c.enLigne ? 'En ligne' : 'Hors ligne'} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{c.nom}</span>
                        <span className="block truncate text-xs text-muted-foreground">{[c.libelleRole, c.lieu].filter(Boolean).join(' — ')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto">
              {convs.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Aucune discussion ce mois-ci.
                  <br />
                  Les conversations sont supprimées le 1er de chaque mois.
                </li>
              )}
              {convs.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPanneau(false);
                      ouvrir({ cle: c.id, contact: c.interlocuteur });
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', c.interlocuteur.enLigne ? 'bg-emerald-500' : 'bg-muted-foreground/30')} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm', c.nonLus > 0 ? 'font-bold' : 'font-medium')}>{c.interlocuteur.nom}</span>
                      <span className={cn('block truncate text-xs', c.nonLus > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                        {c.statut === 'INVITATION' ? (c.initieParMoi ? 'Invitation envoyée…' : 'Vous invite à discuter') : c.statut === 'REFUSEE' ? 'Invitation refusée' : `${c.dernierMessage?.deMoi ? 'Vous : ' : ''}${c.dernierMessage?.apercu ?? ''}`}
                      </span>
                    </span>
                    {c.nonLus > 0 && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{c.nonLus}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* bulle */}
      <button
        type="button"
        onClick={() => setPanneau((o) => !o)}
        className="pointer-events-auto absolute bottom-4 right-4 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={totalNonLus > 0 ? `Messagerie : ${totalNonLus} message${totalNonLus > 1 ? 's' : ''} non lu${totalNonLus > 1 ? 's' : ''}` : 'Messagerie'}
        aria-expanded={panneau}
      >
        <MessageCircle className="size-6" />
        {totalNonLus > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-destructive px-1 text-center text-xs font-bold text-destructive-foreground">{totalNonLus > 99 ? '99+' : totalNonLus}</span>
        )}
      </button>
    </div>
  );
}
