import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { AppRoutes } from "./app-routes";
import { AuthProvider } from "./lib/auth-context";
import { Providers } from "./lib/providers";
import { initTheme } from "./lib/theme";

// Self-hosted Assistant (hebrew + latin subsets) — globals.css names the
// family in --font-sans; this is what actually loads the woff2 files.
// Imported before globals.css so the @font-face rules are registered first.
import "@fontsource-variable/assistant";
import "./globals.css";

// The browser entry point. Provider order matches what app/layout.tsx had:
// Providers (React Query + tRPC + toasts) wraps AuthProvider, because the
// auth context is consumed by components that also issue queries.
//
// BrowserRouter sits outermost so that anything inside a provider can still
// call useNavigate — the role guard in lib/require-role.tsx depends on this.
// Before the first render, so the theme store already holds the saved choice
// when a toggle mounts. index.html painted that theme already; from here on
// lib/theme.ts owns it, including following the OS while set to "system".
initTheme();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
