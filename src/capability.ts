// The supplier's response link is a capability: 32 random bytes, carried in the
// URL fragment so it never reaches a server log. Generating it in the browser
// keeps the token out of every request that is not the supplier's own.
export function newCapabilityToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function supplierLink(token: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.hash = `respond=${encodeURIComponent(token)}`;
  return url.toString();
}
