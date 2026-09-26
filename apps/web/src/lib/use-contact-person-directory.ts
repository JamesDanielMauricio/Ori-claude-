import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ContactPersonOption } from "@/components/reference-data/contact-person-cell";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc-client";

// Backs the "contact person" picker on the Growers/Customers/Transporters
// screens (packages/db/migrations/0057) — every profile in the system,
// joined with its login email and company name. Global, not scoped to any
// one company: a Transporter company never has profiles of its own (see
// packages/db/src/schema/enums.ts's user_role comment), so restricting the
// picker to "this company's users" would make a transporter's contact
// person unsettable. Shared by all three screens rather than duplicated,
// since they need the exact same join users.tsx already does for its own
// email column.
export function useContactPersonDirectory() {
  const supabase = createClient();

  const profilesQuery = useQuery({
    queryKey: ["reference-data", "contact-person-directory-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        // `companies!company_id(...)`, not the bare embed: profiles has two
        // FK paths to companies since this feature's own migration (0057
        // added companies.contact_person_id, a second FK back to profiles)
        // — see auth-context.tsx's loadProfile for the fuller note on why
        // the bare form 300s.
        .select("user_id, display_name, phone_number, companies!company_id(name)")
        .order("display_name");
      if (error) throw error;
      return data as unknown as Array<{
        user_id: string;
        display_name: string;
        phone_number: string | null;
        companies: { name: string } | null;
      }>;
    },
  });

  // Login emails live in `auth.users`, which PostgREST doesn't expose — see
  // users.tsx's identical join and apps/api/src/routers/auth.ts.
  const emailsQuery = trpc.auth.listUserEmails.useQuery();

  const options = useMemo<ContactPersonOption[]>(
    () =>
      (profilesQuery.data ?? []).map((row) => ({
        id: row.user_id,
        name: row.display_name,
        email: emailsQuery.data?.[row.user_id] ?? null,
        phone: row.phone_number,
        companyName: row.companies?.name ?? null,
      })),
    [profilesQuery.data, emailsQuery.data],
  );

  const optionById = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);

  return {
    options,
    optionById,
    isLoading: profilesQuery.isLoading || emailsQuery.isLoading,
    isError: profilesQuery.isError,
    isFetching: profilesQuery.isFetching || emailsQuery.isFetching,
    refetch: () => {
      void profilesQuery.refetch();
      void emailsQuery.refetch();
    },
  };
}
