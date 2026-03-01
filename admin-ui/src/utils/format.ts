/**
 * Formatting and sanitization utilities.
 * Ported 1-to-1 from the vanilla app.js helpers.
 */

/**
 * HTML-escape a string to prevent XSS when inserting into innerHTML.
 * Returns empty string for null / undefined.
 */
export function esc(s: unknown): string {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

/* ------------------------------------------------------------------ */
/* sanitizeHtml -- strip dangerous tags and event-handler attributes   */
/* ------------------------------------------------------------------ */

const UNSAFE_TAGS = new Set([
  "SCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
]);

const _rawInnerHTML = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "innerHTML",
);

/**
 * Sanitize an HTML string by removing dangerous tags (script, iframe, etc.)
 * and stripping event-handler / javascript: attributes.
 */
export function sanitizeHtml(html: unknown): string {
  if (!_rawInnerHTML || !_rawInnerHTML.set || !_rawInnerHTML.get) {
    // Fallback: cannot sanitize without raw descriptor -- return escaped
    return esc(html);
  }

  const template = document.createElement("template");
  _rawInnerHTML.set.call(template, String(html ?? ""));

  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_ELEMENT,
  );
  const toRemove: Element[] = [];

  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    if (UNSAFE_TAGS.has(el.tagName)) {
      toRemove.push(el);
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        value.startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  toRemove.forEach((el) => el.remove());
  return _rawInnerHTML.get!.call(template) as string;
}

/* ------------------------------------------------------------------ */
/* Number / date formatting                                           */
/* ------------------------------------------------------------------ */

const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

/**
 * Format a numeric value as Russian Ruble currency string.
 */
export function formatMoney(value: number | string | null | undefined): string {
  return moneyFmt.format(Number(value || 0));
}

/**
 * Format a date/time value using ru-RU locale.
 * Returns em-dash for falsy input.
 */
export function formatDateTime(value: string | number | null | undefined): string {
  if (!value) return "\u2014";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString("ru-RU");
}

/**
 * Format an ISO timestamp as a relative freshness label
 * (e.g. "только что", "5 мин. назад", "3 ч. назад", or "dd.MM HH:mm").
 * Returns null for falsy input.
 */
export function formatFreshness(isoStr: string | null | undefined): string | null {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч. назад`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

/**
 * Return a traffic-light color string based on how stale an ISO timestamp is.
 *   - "green"  : less than 1 hour ago
 *   - "yellow" : less than 24 hours ago
 *   - "red"    : 24+ hours ago or missing
 */
export function syncStatusColor(
  isoStr: string | null | undefined,
): "green" | "yellow" | "red" {
  if (!isoStr) return "red";
  const diffH = (Date.now() - new Date(isoStr).getTime()) / 3600000;
  if (diffH < 1) return "green";
  if (diffH < 24) return "yellow";
  return "red";
}
