import { queryOptions } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

// The server read behind the self-service profile screen, defined once —
// key + fetch together; see lib/queries/trading-day.ts for why the keys
// matter.

export interface OwnProfile {
  displayName: string;
  phoneNumber: string | null;
}

export const profileQueries = {
  // The signed-in user's own display name and phone number — filtered to
  // their row here; the "profiles_select_own" RLS policy (0003) is what lets
  // every signed-in user read that row.
  own() {
    return queryOptions({
      queryKey: ["profile", "self"],
      queryFn: async (): Promise<OwnProfile> => {
        const supabase = createClient();
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!userData.user) throw new Error("not signed in");

        const { data, error } = await supabase
          .from("profiles")
          .select("display_name, phone_number")
          .eq("user_id", userData.user.id)
          .single();
        if (error) throw error;
        return { displayName: data.display_name, phoneNumber: data.phone_number };
      },
    });
  },
};
