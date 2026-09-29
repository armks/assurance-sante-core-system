import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        // Teintes de la palette lavande : vert, pêche, rose, cyan (cf. globals.css).
        success:
          'border-transparent bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
        warning:
          'border-transparent bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
        danger:
          'border-transparent bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
        info: 'border-transparent bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300',
        muted:
          'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
