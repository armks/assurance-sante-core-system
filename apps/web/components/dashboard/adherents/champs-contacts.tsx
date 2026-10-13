import { ChampTexte } from '@/components/dashboard/patterns';

/**
 * Téléphone et e-mail d'un bénéficiaire — facultatifs (un enfant peut n'avoir aucun contact), formats contrôlés par l'API.
 * Même présentation dans tous les formulaires de création / proposition / modification.
 */
export function ChampsContactsBeneficiaire({
  telephone,
  email,
}: {
  telephone?: string | null;
  email?: string | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ChampTexte name="telephone" label="Téléphone" type="tel" maxLength={20} defaultValue={telephone ?? ''} aide="Facultatif." />
      <ChampTexte name="email" label="E-mail" type="email" maxLength={200} defaultValue={email ?? ''} aide="Facultatif." />
    </div>
  );
}

/** Lit les deux contacts d'un formulaire (chaînes vides = non renseigné). */
export function lireContacts(fd: FormData): { telephone: string; email: string } {
  return { telephone: String(fd.get('telephone') ?? '').trim(), email: String(fd.get('email') ?? '').trim() };
}
