import { Injectable } from '@nestjs/common';
import { Observable, type Subscriber } from 'rxjs';

export interface EvenementMessagerie {
  type: 'message' | 'invitation' | 'accepte' | 'refuse' | 'lu' | 'saisie' | 'purge' | 'ping' | 'pret';
  conversationId?: string;
  message?: unknown;
  par?: string;
}

/**
 * Diffusion instantanée (Server-Sent Events) des événements de la messagerie aux onglets connectés de chaque utilisateur.
 * Mémoire du processus : avec plusieurs instances d'API, il faudrait un bus partagé (Redis).
 */
@Injectable()
export class MessagerieHub {
  private readonly abonnes = new Map<string, Set<Subscriber<{ data: EvenementMessagerie }>>>();

  abonner(userId: string): Observable<{ data: EvenementMessagerie }> {
    return new Observable((obs) => {
      const set = this.abonnes.get(userId) ?? new Set();
      set.add(obs);
      this.abonnes.set(userId, set);
      obs.next({ data: { type: 'pret' } });
      // battement : garde la connexion ouverte à travers les proxys et détecte les clients disparus
      const battement = setInterval(() => obs.next({ data: { type: 'ping' } }), 25_000);
      return () => {
        clearInterval(battement);
        set.delete(obs);
        if (set.size === 0) this.abonnes.delete(userId);
      };
    });
  }

  publier(userId: string, evenement: EvenementMessagerie): void {
    for (const o of this.abonnes.get(userId) ?? []) o.next({ data: evenement });
  }

  publierATous(evenement: EvenementMessagerie): void {
    for (const id of this.abonnes.keys()) this.publier(id, evenement);
  }

  enLigne(userId: string): boolean {
    return (this.abonnes.get(userId)?.size ?? 0) > 0;
  }
}
