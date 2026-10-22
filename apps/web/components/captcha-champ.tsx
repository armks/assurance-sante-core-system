'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { DefiCaptcha } from '@/lib/captcha';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ValeurCaptcha {
  jeton: string;
  reponse: string;
}

/**
 * Champ CAPTCHA : image à recopier, bouton pour en obtenir une autre, saisie. Le parent reçoit le jeton et la réponse à chaque
 * frappe ; `renouveler` (nombre qui change) force une nouvelle image — à utiliser après un refus du serveur, car un jeton ne sert qu'une fois.
 */
export function CaptchaChamp({ onChange, renouveler = 0 }: { onChange: (v: ValeurCaptcha) => void; renouveler?: number }) {
  const [image, setImage] = useState<string | null>(null);
  const [jeton, setJeton] = useState('');
  const [reponse, setReponse] = useState('');
  const [chargement, setChargement] = useState(false);
  const [indisponible, setIndisponible] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    setIndisponible(false);
    try {
      const r = await fetch('/auth/captcha', { cache: 'no-store' });
      if (!r.ok) throw new Error(`captcha ${r.status}`);
      const d = (await r.json()) as DefiCaptcha;
      setImage(d.image);
      setJeton(d.jeton);
      setReponse('');
      onChange({ jeton: d.jeton, reponse: '' });
    } catch {
      setIndisponible(true);
    } finally {
      setChargement(false);
    }
  }, [onChange]);

  // premier défi à l'affichage, puis à chaque demande du parent (après un refus)
  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renouveler]);

  return (
    <div className="grid gap-2">
      <Label htmlFor="captcha">Vérification de sécurité</Label>
      <div className="flex items-center gap-2">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- image SVG générée à la volée (data URL)
          <img src={image} alt="Caractères à recopier" width={190} height={60} className="h-[60px] w-[190px] rounded-md border bg-muted" />
        ) : (
          <div className="grid h-[60px] w-[190px] place-items-center rounded-md border bg-muted text-xs text-muted-foreground">
            {indisponible ? 'Indisponible' : 'Chargement…'}
          </div>
        )}
        <button
          type="button"
          onClick={() => void charger()}
          disabled={chargement}
          aria-label="Afficher une autre image"
          title="Autre image"
          className="grid size-9 place-items-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className={`size-4 ${chargement ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <Input
        id="captcha"
        name="captcha"
        value={reponse}
        onChange={(e) => {
          setReponse(e.target.value);
          onChange({ jeton, reponse: e.target.value });
        }}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={8}
        required
        placeholder="Recopiez les 5 caractères"
        aria-describedby="captcha-aide"
        className="font-mono uppercase tracking-widest"
      />
      <p id="captcha-aide" className="text-xs text-muted-foreground">
        Lettres et chiffres, sans distinction majuscule / minuscule.
      </p>
      {indisponible && <p className="text-sm text-destructive">Vérification indisponible : réessayez avec le bouton ci-dessus.</p>}
    </div>
  );
}
