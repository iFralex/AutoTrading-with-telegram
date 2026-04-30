import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Strip spaces, invisible chars, dashes, parens — keep only digits and one leading +
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "")
  return cleaned.replace(/\++/, "+")
}
