'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { activerLicence } from '@/app/licence-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Met en forme la saisie : majuscules, sans caractère parasite, groupes de 4 séparés par un tiret (XXXX-XXXX-XXXX). */
function formater(v: string): string {
  const net = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
  return net.match(/.{1,4}/g)?.join('-') ?? '';
}

/** Saisie du code d'activation temporaire : sert dans la fenêtre bloquante de connexion et dans la page « Licence » (renouvellement). */
export function FormulaireActivation({ libelleBouton = 'Activer la licence' }: { libelleBouton?: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const complet = code.replace(/-/g, '').length === 12;

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    if (!complet || pending) return;
    setErreur(null);
    startTransition(async () => {
      const res = await activerLicence(code);
      if (!res.ok) {
        setErreur(res.error);
        return;
      }
      setSucces(res.message);
      setCode('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={soumettre} className="space-y-3" aria-label="Activation de la licence">
      <label htmlFor="code-activation" className="block text-sm font-medium">
        Code d’activation
      </label>
      <div className="flex gap-2">
        <Input
          id="code-activation"
          value={code}
          onChange={(e) => setCode(formater(e.target.value))}
          placeholder="XXXX-XXXX-XXXX"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={14}
          aria-describedby="aide-code-activation"
          className="h-10 flex-1 font-mono tracking-widest"
        />
        <Button type="submit" disabled={!complet || pending}>
          <KeyRound className="size-4" aria-hidden="true" />
          {pending ? 'Vérification…' : libelleBouton}
        </Button>
      </div>
      <p id="aide-code-activation" className="text-xs text-muted-foreground">
        Code temporaire transmis par le support de la plateforme : à usage unique, valable 24 h.
      </p>
      <div aria-live="polite" className="min-h-5 text-sm">
        {erreur && <p className="text-destructive">{erreur}</p>}
        {succes && <p className="text-emerald-600 dark:text-emerald-400">{succes}</p>}
      </div>
    </form>
  );
}
