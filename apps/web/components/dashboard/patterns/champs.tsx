import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const CLASSE_SELECT =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

/** Enveloppe libellée générique — libellé + zone de champ + aide. */
export function Champ({
  label,
  htmlFor,
  aide,
  requis,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  aide?: string;
  requis?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {requis && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
    </div>
  );
}

export function ChampTexte({
  name,
  label,
  aide,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'name'> & {
  name: string;
  label: string;
  aide?: string;
}) {
  const id = `champ-${name}`;
  return (
    <Champ
      label={label}
      htmlFor={id}
      aide={aide}
      requis={props.required}
      className={className}
    >
      <Input id={id} name={name} {...props} />
    </Champ>
  );
}

export function ChampNombre(
  props: Omit<React.ComponentProps<typeof ChampTexte>, 'type' | 'inputMode'>,
) {
  return <ChampTexte {...props} type="number" inputMode="decimal" />;
}

export function ChampZone({
  name,
  label,
  aide,
  className,
  ...props
}: Omit<React.ComponentProps<'textarea'>, 'name'> & {
  name: string;
  label: string;
  aide?: string;
}) {
  const id = `champ-${name}`;
  return (
    <Champ
      label={label}
      htmlFor={id}
      aide={aide}
      requis={props.required}
      className={className}
    >
      <textarea
        id={id}
        name={name}
        className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        {...props}
      />
    </Champ>
  );
}

export interface OptionChamp {
  valeur: string;
  libelle: string;
}

export function ChampSelect({
  name,
  label,
  aide,
  options,
  placeholder,
  className,
  ...props
}: Omit<React.ComponentProps<'select'>, 'name'> & {
  name: string;
  label: string;
  aide?: string;
  options: OptionChamp[];
  placeholder?: string;
}) {
  const id = `champ-${name}`;
  return (
    <Champ
      label={label}
      htmlFor={id}
      aide={aide}
      requis={props.required}
      className={className}
    >
      <select id={id} name={name} className={CLASSE_SELECT} {...props}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.libelle}
          </option>
        ))}
      </select>
    </Champ>
  );
}

/** Champ fichier(s) — `fd.getAll(name)` renvoie les `File` côté `onSoumettre`. */
export function ChampFichier({
  name,
  label,
  aide,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'name' | 'type'> & {
  name: string;
  label: string;
  aide?: string;
}) {
  const id = `champ-${name}`;
  return (
    <Champ label={label} htmlFor={id} aide={aide} requis={props.required} className={className}>
      <input
        id={id}
        name={name}
        type="file"
        className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
        {...props}
      />
    </Champ>
  );
}

export function ChampCheckbox({
  name,
  label,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'name' | 'type'> & {
  name: string;
  label: string;
}) {
  return (
    <label className={cn('flex items-center gap-2 text-sm', className)}>
      <input type="checkbox" name={name} className="size-4" {...props} />
      {label}
    </label>
  );
}
