import { queryOptions } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

// Server reads behind the two user-administration screens (bulk import and
// admin password reset), each defined once — key + fetch together; see
// lib/queries/trading-day.ts for why the keys matter. The writes themselves
// go through apps/api (service-role operations), not through these.

export interface CompanyOption {
  id: string;
  name: string;
  type: string;
  status: "active" | "inactive";
}

export interface ResettableUser {
  user_id: string;
  display_name: string;
  phone_number: string | null;
  companies: { name: string } | null;
}

export const usersAdminQueries = {
  // Every company, so an imported user's company is picked by name rather
  // than typed in as a UUID, which no screen shows. Readable by backoffice
  // through the companies RLS policies.
  importCompanies() {
    return queryOptions({
      queryKey: ["users-import", "companies"],
      queryFn: async (): Promise<CompanyOption[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select("id, name, type, status")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  // Every user who could have their password reset, with their company.
  resettableUsers() {
    return queryOptions({
      queryKey: ["users-reset", "users"],
      queryFn: async (): Promise<ResettableUser[]> => {
        const { data, error } = await createClient()
          .from("profiles")
          // `companies!company_id(...)`, not the bare embed: profiles has two
          // FK paths to companies since migration 0057 (company_id, and the
          // reverse via companies.contact_person_id) — see auth-context.tsx's
          // loadProfile for the fuller note on why the bare form 300s.
          .select("user_id, display_name, phone_number, companies!company_id(name)")
          .order("display_name");
        if (error) throw error;
        return data;
      },
    });
  },
};
