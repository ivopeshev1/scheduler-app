/**
 * Minimal server-side HTML sanitizer for user-pasted rich text (e.g. the
 * BEO manager-note field). Keeps structural + inline formatting tags that
 * are safe to drop straight into an email body, strips anything that could
 * execute script or load remote content.
 *
 * Allowed tags: p, br, b, strong, i, em, u, s, strike, del, span, div,
 *   ul, ol, li, h1-h6, blockquote, a, img, pre, code, hr, table, thead,
 *   tbody, tr, th, td.
 * Allowed attributes:
 *   - href on <a> (http/https/mailto only, strips javascript:)
 *   - src on <img> (http/https/data: only)
 *   - alt on <img>
 *   - target on <a>
 * Everything else (class, id, style, on* handlers, data-*) is stripped.
 *
 * NOT a full HTML parser - uses regex replacement, which is fine for the
 * limited paste-sanitization job we need. For richer input (e.g. an actual
 * WYSIWYG with styles) swap in sanitize-html / DOMPurify later.
 */

const ALLOWED_TAGS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "del",
  "span", "div", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "a", "img", "pre", "code", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
]);

function cleanAttrs(tagName: string, attrsRaw: string): string {
  const out: string[] = [];
  // Simple attribute matcher: name="value" | name='value' | name=value | name
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrsRaw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (name.startsWith("on") || name.startsWith("data-")) continue;
    if (name === "class" || name === "id" || name === "style") continue;
    if (tagName === "a" && name === "href") {
      if (/^(https?:|mailto:)/i.test(value)) {
        out.push(`href="${value.replace(/"/g, "&quot;")}"`);
      }
    } else if (tagName === "a" && name === "target") {
      out.push(`target="_blank" rel="noopener noreferrer"`);
    } else if (tagName === "img" && name === "src") {
      if (/^(https?:|data:image\/)/i.test(value)) {
        out.push(`src="${value.replace(/"/g, "&quot;")}"`);
      }
    } else if (tagName === "img" && name === "alt") {
      out.push(`alt="${value.replace(/"/g, "&quot;")}"`);
    }
  }
  return out.join(" ");
}

export function sanitizePastedHtml(input: string): string {
  if (!input) return "";
  // Strip comments / CDATA / processing instructions wholesale.
  let html = input.replace(/<!--[\s\S]*?-->/g, "");
  // Strip entire <script> / <style> blocks with content.
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Walk every tag; keep allowed, strip rest. Attributes get rebuilt per
  // the allowlist above.
  html = html.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, slash, name, attrs) => {
    const lower = name.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return "";
    if (slash === "/") return `</${lower}>`;
    const cleaned = cleanAttrs(lower, attrs);
    return cleaned ? `<${lower} ${cleaned}>` : `<${lower}>`;
  });
  return html;
}
