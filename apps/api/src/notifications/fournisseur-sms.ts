/**
 * Fournisseur de SMS REMPLAÇABLE. Le reste de l'application ne dépend que de cette interface ; brancher un vrai
 * fournisseur = écrire un adaptateur qui l'implémente et l'enregistrer dans `NotificationsModule` (variable
 * `SMS_FOURNISSEUR`). Tant qu'aucune clé n'existe, l'adaptateur `FournisseurSmsDesactive` est utilisé : il n'envoie rien.
 */
export interface ResultatSms {
  envoye: boolean;
  /** Identifiant du message chez le fournisseur. */
  id?: string;
  erreur?: string;
}

export interface FournisseurSms {
  /** Nom court de l'adaptateur (journal et audit). */
  readonly nom: string;
  /** Vrai seulement si l'adaptateur peut réellement envoyer (clé présente, activé). */
  estActif(): boolean;
  envoyer(numero: string, message: string): Promise<ResultatSms>;
}

export const FOURNISSEUR_SMS = Symbol('FOURNISSEUR_SMS');

/** Adaptateur par défaut : aucun fournisseur configuré — n'envoie jamais rien. */
export class FournisseurSmsDesactive implements FournisseurSms {
  readonly nom = 'desactive';
  estActif(): boolean {
    return false;
  }
  async envoyer(): Promise<ResultatSms> {
    return { envoye: false, erreur: 'Aucun fournisseur SMS configuré.' };
  }
}
