import { escapeHtml } from "@/lib/notifications";

/**
 * Shared helpers so every outbound email (invite, cancel, update, position-removed)
 * renders with the same look - same font stack, spacing, label styling, etc.
 *
 * Kept deliberately tiny: inline styles, no <style> blocks (Gmail strips those),
 * no external CSS, no React - just string concatenation. Plain-text fallbacks
 * are still built separately at each callsite.
 */

export function shellWrap(innerHtml: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;font-size:15px;max-width:560px;margin:0 auto;padding:24px;">
${innerHtml}
</body></html>`;
}

export function kvRow(label: string, value: string, opts?: { bold?: boolean }): string {
  const bold = opts?.bold ?? false;
  return (
    `<tr>` +
    `<td style="padding:4px 16px 4px 0;color:#555;white-space:nowrap;${bold ? "font-weight:600;color:#111;" : ""}">${escapeHtml(label)}</td>` +
    `<td style="padding:4px 0;${bold ? "font-weight:600;" : ""}">${escapeHtml(value)}</td>` +
    `</tr>`
  );
}

export function kvTable(rowsHtml: string[]): string {
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">${rowsHtml.filter(Boolean).join("")}</table>`;
}

export function greeting(firstName: string | null | undefined, intro: string): string {
  const name = firstName ?? "";
  return `<p style="margin:0 0 12px;">Hi ${escapeHtml(name)},</p>\n<p style="margin:0 0 20px;">${escapeHtml(intro)}</p>`;
}

export function paragraph(text: string, opts?: { muted?: boolean }): string {
  const muted = opts?.muted ?? false;
  return `<p style="margin:0 0 12px;${muted ? "color:#555;" : ""}">${escapeHtml(text)}</p>`;
}

export function banner(text: string, tone: "warning" | "info" = "warning"): string {
  const colors =
    tone === "warning"
      ? { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c" }
      : { bg: "#eff6ff", border: "#3b82f6", text: "#1d4ed8" };
  return `<div style="background:${colors.bg};border-left:4px solid ${colors.border};padding:12px 14px;margin:0 0 20px;color:${colors.text};font-weight:600;">${escapeHtml(text)}</div>`;
}

export function signoff(companyName: string): string {
  return `<p style="margin:24px 0 0;color:#555;">– ${escapeHtml(companyName)}</p>`;
}
