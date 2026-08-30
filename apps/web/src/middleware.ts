import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { VERIFIED_USER_EMAIL_HEADER, VERIFIED_USER_ID_HEADER } from "./lib/auth-headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./lib/public-env";

// Required by @supabase/ssr's design: Server Components can read cookies
// but never write them, so the session's access/refresh token pair can't
// be renewed there. This runs before every request and rewrites the
// cookie if Supabase refreshed the session, so by the time a layout's
// server client reads it, it's current.
//
// It also forwards the identity it just verified to Server Components on
// two request headers, so `getCurrentUser()` doesn't repeat this exact
// `auth.getUser()` call a second time per request — that duplicate was
// costing a full Supabase round trip on every navigation.
export async function middleware(request: NextRequest) {
  // Holds whatever cookies Supabase writes during the refresh. The
  // response actually returned has to be built *after* getUser() resolves
  // — that's the only point where the verified identity is known and can
  // be put on the outgoing request headers — so these are parked here and
  // copied across at the end.
  let refreshed = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          // Keep the incoming request in sync too, so anything reading
          // cookies downstream in this same pass sees the refreshed pair.
          request.cookies.set(name, value);
        }
        refreshed = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          refreshed.cookies.set(name, value, options);
        }
      },
    },
  });

  // The one real verification per request: round-trips to Supabase to
  // validate the token rather than trusting the cookie's claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const requestHeaders = new Headers(request.headers);

  // SECURITY: delete before set, unconditionally and on every path —
  // including when there is no user. A client is free to send these
  // headers itself; stripping them here is what guarantees an app route
  // only ever sees a value this middleware wrote after a real token
  // check. Without the delete, an unauthenticated request could name any
  // user it liked and the guard would skip its own verification.
  requestHeaders.delete(VERIFIED_USER_ID_HEADER);
  requestHeaders.delete(VERIFIED_USER_EMAIL_HEADER);
  if (user?.email) {
    requestHeaders.set(VERIFIED_USER_ID_HEADER, user.id);
    // Encoded because header values are limited to ASCII and an address
    // may legitimately contain non-ASCII; auth-guard.ts decodes it.
    requestHeaders.set(VERIFIED_USER_EMAIL_HEADER, encodeURIComponent(user.email));
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of refreshed.cookies.getAll()) {
    response.cookies.set(cookie);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
