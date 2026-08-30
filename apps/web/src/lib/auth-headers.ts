// Header names middleware.ts uses to hand a request's already-verified
// identity down to Server Components, so the auth guard doesn't repeat the
// network call middleware just made (see lib/auth-guard.ts).
//
// Deliberately NOT marked "server-only": middleware runs in the Edge
// runtime and imports these too, and that pragma would break it.
//
// SECURITY — these are internal, forgeable-looking names on purpose. A
// client CAN send them; middleware unconditionally deletes both before
// setting its own values, so nothing a caller supplies ever reaches an
// app route. Treat any value read from them as "middleware verified this
// for the current request", never as "the caller claims to be this".
export const VERIFIED_USER_ID_HEADER = "x-ori-verified-user-id";
export const VERIFIED_USER_EMAIL_HEADER = "x-ori-verified-user-email";
