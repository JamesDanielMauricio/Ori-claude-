import { Assistant } from "next/font/google";
import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth-context";
import { Providers } from "@/lib/providers";

import "./globals.css";

// Assistant is a Hebrew-first typeface (SIL OFL, designed for Hebrew UI
// text) — globals.css already named it first in --font-sans, but nothing
// ever loaded it, so every machine silently fell back to Segoe UI/Arial.
// next/font self-hosts it at build time: no runtime request to Google,
// no layout shift (size-adjusted fallback generated automatically).
const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  variable: "--font-assistant",
});

export const metadata = {
  // The source titles its pages "אורי והבננות" — the product's real name;
  // the platform is Hebrew-only (known-gaps.md G14).
  title: "אורי והבננות",
  description: "ניהול הזמנות ומלאי לשיווק תוצרת חקלאית",
};

// The source product is Hebrew-only, RTL-only — see known-gaps.md G14
// ("the platform is a Hebrew-only private business app, not a SaaS. There
// is no localization or translation rigor target"). RTL is therefore a
// root-level, first-class setting here, not a per-component patch applied
// after the fact.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={assistant.variable}>
      <body>
        <Providers>
          <AuthProvider>{children}</AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
