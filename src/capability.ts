// An operator's response link is a capability: 32 random bytes, generated in the
// advisor's browser and carried in the URL fragment, so it never appears in a
// request line, a referrer or a server log. The server stores the token but never
// has to invent one, and every read or write through it is scoped to the single
// operator the row belongs to.
export function newCapabilityToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function responseLink(token: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `respond=${encodeURIComponent(token)}`;
  return url.toString();
}

// The token as it was opened, or null for the agency's own workspace.
export function readResponseToken(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const value = new URLSearchParams(hash).get("respond");
  if (!value) return null;
  const token = value.trim();
  return /^[A-Za-z0-9_-]{40,80}$/.test(token) ? token : null;
}
