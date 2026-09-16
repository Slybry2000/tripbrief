import { env } from "./_generated/server";

// Sign-in mail: the code that proves an address is yours, and the code that lets
// you back in after forgetting a password.
//
// It goes out through the mail account the product already has, so there is no
// second service to configure and the sponsor that carries everything else
// carries this too. The code is a short one-time token: the verification call has
// to repeat the address it was sent to, so a code on its own is not enough to get
// in.

export function codeMessage(kind: "verify" | "reset", code: string) {
  if (kind === "reset") {
    return {
      subject: `Your TripBrief reset code: ${code}`,
      text: [
        `Your password reset code is ${code}.`,
        "",
        "Enter it on the sign-in screen and choose a new password. The code expires in fifteen minutes.",
        "",
        "If you did not ask to reset your password, ignore this message: nothing has changed.",
      ].join("\n"),
    };
  }
  return {
    subject: `Your TripBrief code: ${code}`,
    text: [
      `Your sign-in code is ${code}.`,
      "",
      "Enter it to finish creating your account. The code expires in fifteen minutes.",
      "",
      "If you did not try to create an account, ignore this message.",
    ].join("\n"),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Where the mail comes from. A deployment can name the address it wants with
// AUTH_MAIL_FROM; otherwise it uses an inbox the account already has, which is
// what keeps a deployment self-configuring instead of needing another secret.
export async function pickSender(key: string) {
  const preferred = env.AUTH_MAIL_FROM?.trim();
  if (preferred) return preferred;
  const response = await fetch("https://api.agentmail.to/v0/inboxes", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok)
    throw new Error("The mail service could not be reached, so the code was not sent.");
  const body: unknown = await response.json().catch(() => null);
  const list =
    body && typeof body === "object" && "inboxes" in body ? body.inboxes : null;
  const addresses = Array.isArray(list)
    ? list
        .map((entry) =>
          entry && typeof entry === "object" && "email" in entry
            ? (entry as { email: unknown }).email
            : null,
        )
        .filter((email): email is string => typeof email === "string")
        .sort()
    : [];
  if (!addresses.length)
    throw new Error(
      "This deployment has no mail inbox to send a code from. Add one, or set AUTH_MAIL_FROM.",
    );
  return addresses[0];
}

export async function sendAuthMail(
  email: string,
  code: string,
  kind: "verify" | "reset" = "verify",
) {
  const key = env.AGENTMAIL_API_KEY?.trim();
  if (!key)
    throw new Error(
      "Mail is not configured on this deployment, so the code cannot be sent.",
    );
  const from = await pickSender(key);
  const { subject, text } = codeMessage(kind, code);
  const response = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(from)}/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      // One code per request: a retry of the same request must not send twice.
      body: JSON.stringify({
        to: [email],
        subject,
        text,
        html: `<p>${escapeHtml(text).replaceAll("\n", "<br />")}</p>`,
        labels: [kind === "reset" ? "password-reset" : "email-verification"],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => null);
  if (!response?.ok)
    throw new Error(
      `The code could not be sent (status ${response?.status ?? 0}). Please try again.`,
    );
}
