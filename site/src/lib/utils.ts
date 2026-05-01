import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Normalize phone to E.164-style (+countrycode...).
// Handles: spaces/dashes/parens, 00-prefix (→ +), bare digits without +.
// Bare digit strings that look like local numbers are returned as-is so the
// backend suffix-match can still find them.
export function normalizePhone(raw: string): string {
  let s = raw.replace(/[\s\-().]/g, "")
  s = s.replace(/\++/, "+")
  if (s.startsWith("00")) s = "+" + s.slice(2)
  return s
}
