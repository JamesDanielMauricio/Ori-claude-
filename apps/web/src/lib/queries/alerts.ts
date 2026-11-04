import { queryOptions } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

// The server read behind the alerts bell in every role's shell, defined once
// — key + fetch together; see lib/queries/trading-day.ts for why the keys
// matter. RLS (packages/db/migrations/0023) restricts every row this can
// ever return to the signed-in user's own alerts.

export interface AlertRow {
  id: string;
  read: boolean;
  display_record_id: string | null;
  number_for_display: number | null;
  full_name_for_display: string | null;
  created_at: string;
  alert_types: {
    main_text: string;
    second_line_of_text: string | null;
    app_screen: string;
    url_parameter: string | null;
  } | null;
}

export const alertsQueries = {
  // The signed-in user's 50 most recent alerts, newest first.
  own() {
    return queryOptions({
      queryKey: ["alerts", "own"],
      queryFn: async (): Promise<AlertRow[]> => {
        const { data, error } = await createClient()
          .from("alerts")
          .select(
            "id, read, display_record_id, number_for_display, full_name_for_display, created_at, alert_types(main_text, second_line_of_text, app_screen, url_parameter)",
          )
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        return data;
      },
      // Alerts are typically created by a backoffice action (e.g. Close
      // Arrangement) the signed-in user isn't the one triggering. They show up
      // within about a second (lib/live-updates.ts), replacing the 60-second
      // poll this query used to run on every open device, used or not.
      //
      // The live updates re-run this query whenever ANY alert changes, not only
      // this user's own — the message says a table changed, never whose row.
      // That costs one small read; what comes back is still only this user's
      // alerts, because RLS decides that, not the message.
    });
  },
};
