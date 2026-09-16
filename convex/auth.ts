import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Email } from "@convex-dev/auth/providers/Email";
import { sendAuthMail } from "./authMail";

// Accounts are email and password, and the address has to be proved to be yours
// before the account works. That is not ceremony: an account's address is what
// decides whether it may send email to real operators, so an unproved address
// would let somebody claim an identity the deployment trusts.
//
// The same code path backs both flows: proving the address at sign-up, and
// getting back in after a forgotten password. A trial workspace stays one click,
// and can do everything except send.
const signInMail = Email({
  id: "tripbrief-mail",
  maxAge: 60 * 15,
  async sendVerificationRequest({ identifier, token }) {
    await sendAuthMail(identifier, token, "verify");
  },
});

const resetMail = Email({
  id: "tripbrief-mail-reset",
  maxAge: 60 * 15,
  async sendVerificationRequest({ identifier, token }) {
    await sendAuthMail(identifier, token, "reset");
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({ verify: signInMail, reset: resetMail }),
    Anonymous,
  ],
});
