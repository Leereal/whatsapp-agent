/**
 * "+27 71 000 5678" → "+27710005678"; South African local numbers get +27.
 * Null for anything that isn't a phone number (i.e. a saved contact's name).
 * Same rules as the backend's normalizePhone.
 */
export function normalizePhone(raw: string): string | null {
  const value = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;

  let digits = value.replace(/\D/g, "");
  if (!value.startsWith("+")) {
    if (digits.length === 10 && digits.startsWith("0")) digits = `27${digits.slice(1)}`;
    else return null;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}
