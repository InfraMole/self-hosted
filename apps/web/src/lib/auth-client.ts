// SPDX-License-Identifier: AGPL-3.0-only
import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. Requests go through /api/auth (Better Auth handler),
 * which applies rate limiting and origin checks. Do not call
 * auth.api.signInEmail/signUpEmail from server actions: that bypasses rate limiting.
 */
export const authClient = createAuthClient({
  plugins: [
    // Sign-in forms handle `twoFactorRedirect` themselves (they keep ?next=).
    twoFactorClient({ onTwoFactorRedirect: () => {} }),
    passkeyClient(),
  ],
});
