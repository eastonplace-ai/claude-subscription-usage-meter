import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { parseISO, isValid } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeParseDate(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/\*+/g, '').trim();
  if (!cleaned) return null;
  const d = parseISO(cleaned);
  return isValid(d) ? d : null;
}
