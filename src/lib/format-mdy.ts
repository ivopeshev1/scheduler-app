/** YYYY-MM-DD → MM/DD/YYYY. Used anywhere the Payroll tab prints a date. */
export function formatMDY(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[2]}/${m[3]}/${m[1]}`;
}
