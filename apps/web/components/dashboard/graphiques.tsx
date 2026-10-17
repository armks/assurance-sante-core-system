'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Palette vive et franche, lisible en thème clair comme sombre. */
export const PALETTE_GRAPHIQUES = [
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#10b981', // émeraude
  '#f59e0b', // ambre
  '#f43f5e', // rose
  '#8b5cf6', // violet
  '#ec4899', // fuchsia
  '#14b8a6', // turquoise
] as const;

export const COULEUR = {
  indigo: PALETTE_GRAPHIQUES[0],
  cyan: PALETTE_GRAPHIQUES[1],
  vert: PALETTE_GRAPHIQUES[2],
  ambre: PALETTE_GRAPHIQUES[3],
  rose: PALETTE_GRAPHIQUES[4],
  violet: PALETTE_GRAPHIQUES[5],
} as const;

export interface PointDonut {
  nom: string;
  valeur: number;
  couleur?: string;
}

const francs = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const compact = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
    : Math.abs(n) >= 1_000
      ? `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`
      : String(n);

const STYLE_INFOBULLE = {
  borderRadius: 10,
  border: '1px solid var(--border, #e5e7eb)',
  background: 'var(--card, #fff)',
  color: 'var(--card-foreground, #111)',
  fontSize: 12,
  boxShadow: '0 6px 20px rgba(0,0,0,.12)',
};

/** Carte de graphique : bandeau coloré, icône, titre, contenu. */
export function CarteGraphique({
  titre,
  description,
  icon: Icon,
  couleur = COULEUR.indigo,
  className,
  children,
}: {
  titre: string;
  description?: string;
  icon?: LucideIcon;
  couleur?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('overflow-hidden gap-3 py-0', className)}>
      <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${couleur}, ${couleur}55)` }} />
      <CardHeader className="flex flex-row items-center gap-3 px-5 pb-0 pt-3">
        {Icon && (
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl"
            style={{ background: `${couleur}22`, color: couleur }}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <CardTitle className="text-sm">{titre}</CardTitle>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-4">{children}</CardContent>
    </Card>
  );
}

function Vide() {
  return <p className="grid h-56 place-items-center text-sm text-muted-foreground">Pas encore de données.</p>;
}

/** Anneau avec total au centre et légende. */
export function GraphiqueDonut({
  donnees,
  libelleTotal = 'Total',
  formatValeur = (n: number) => n.toLocaleString('fr-FR'),
}: {
  donnees: PointDonut[];
  libelleTotal?: string;
  formatValeur?: (n: number) => string;
}) {
  const points = donnees.filter((d) => d.valeur > 0);
  const total = points.reduce((s, d) => s + d.valeur, 0);
  if (total === 0) return <Vide />;
  return (
    <div className="relative h-60">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={points}
            dataKey="valeur"
            nameKey="nom"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={3}
            cornerRadius={6}
            stroke="none"
          >
            {points.map((p, i) => (
              <Cell key={p.nom} fill={p.couleur ?? PALETTE_GRAPHIQUES[i % PALETTE_GRAPHIQUES.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={STYLE_INFOBULLE} formatter={(v) => formatValeur(Number(v))} />
          <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[34%] text-center">
        <p className="text-xl font-semibold tabular-nums">{formatValeur(total)}</p>
        <p className="text-xs text-muted-foreground">{libelleTotal}</p>
      </div>
    </div>
  );
}

export interface SerieGraphique {
  cle: string;
  nom: string;
  couleur: string;
}

/** Barres (verticales ou horizontales), éventuellement empilées. */
export function GraphiqueBarres({
  donnees,
  series,
  horizontal = false,
  empile = false,
  monetaire = false,
}: {
  donnees: Record<string, string | number>[];
  series: SerieGraphique[];
  horizontal?: boolean;
  empile?: boolean;
  monetaire?: boolean;
}) {
  if (donnees.length === 0) return <Vide />;
  const fmt = monetaire ? francs : (n: number) => n.toLocaleString('fr-FR');
  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: horizontal ? 8 : -8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} stroke="currentColor" opacity={0.12} />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="nom" width={110} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="nom" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            </>
          )}
          <Tooltip contentStyle={STYLE_INFOBULLE} cursor={{ fill: 'currentColor', opacity: 0.06 }} formatter={(v) => fmt(Number(v))} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Bar
              key={s.cle}
              dataKey={s.cle}
              name={s.nom}
              fill={s.couleur}
              stackId={empile ? 'a' : undefined}
              radius={empile ? 0 : horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}
              maxBarSize={36}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Courbes en aires dégradées (évolution dans le temps). */
export function GraphiqueAire({
  donnees,
  series,
  monetaire = false,
}: {
  donnees: Record<string, string | number>[];
  series: SerieGraphique[];
  monetaire?: boolean;
}) {
  if (donnees.length === 0) return <Vide />;
  const fmt = monetaire ? francs : (n: number) => n.toLocaleString('fr-FR');
  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={donnees} margin={{ left: -8, right: 8 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.cle} id={`degrade-${s.cle}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.couleur} stopOpacity={0.55} />
                <stop offset="95%" stopColor={s.couleur} stopOpacity={0.04} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.12} />
          <XAxis dataKey="nom" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={STYLE_INFOBULLE} formatter={(v) => fmt(Number(v))} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Area
              key={s.cle}
              type="monotone"
              dataKey={s.cle}
              name={s.nom}
              stroke={s.couleur}
              strokeWidth={2.5}
              fill={`url(#degrade-${s.cle})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
