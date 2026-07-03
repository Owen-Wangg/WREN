/**
 * `cn` — the standard shadcn/ui class-name helper. Merges conditional class
 * lists (`clsx`) and de-duplicates conflicting Tailwind utilities
 * (`tailwind-merge`) so token-derived utility classes compose predictably.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
