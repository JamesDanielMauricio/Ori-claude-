import { queryOptions } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";

// Server reads behind the Shop screen and the sidebar's business-day panel,
// each defined once (key + fetch together — see lib/queries/trading-day.ts
// for why the keys matter). BusinessDayPanel refreshes both prefixes below
// whenever the day changes phase.

export const shopPanelKeys = {
  all: ["shop-panel"] as const,
  metrics: (dayId: string | undefined) => ["shop-panel", "metrics", dayId] as const,
  notificationSettings: ["shop-panel", "notification-settings"] as const,
};

export const businessDayPanelKeys = {
  all: ["business-day-panel"] as const,
  shop: (dayId: string | undefined) => ["business-day-panel", "shop", dayId] as const,
};

export interface NotificationSettingsRow {
  whatsapp_enabled: boolean;
  notify_growers_on_business_day_open: boolean;
  shop_open_whatsapp_enabled: boolean;
  close_arrangement_customer_whatsapp_enabled: boolean;
  close_arrangement_grower_whatsapp_enabled: boolean;
}

export const shopQueries = {
  // How many picks and orders the day has, and how many are in.
  metrics(dayId: string | undefined) {
    return queryOptions({
      queryKey: shopPanelKeys.metrics(dayId),
      enabled: !!dayId,
      queryFn: async () => {
        const supabase = createClient();
        const [picks, orders] = await Promise.all([
          supabase.from("daily_picks").select("status").eq("trading_day_id", dayId!),
          supabase.from("daily_orders").select("status").eq("trading_day_id", dayId!),
        ]);
        if (picks.error) throw picks.error;
        if (orders.error) throw orders.error;
        return {
          picksTotal: picks.data.length,
          picksSubmitted: picks.data.filter((row) => row.status !== "draft").length,
          ordersTotal: orders.data.length,
          ordersSubmitted: orders.data.filter((row) => row.status === "submitted").length,
        };
      },
    });
  },

  // The WhatsApp switches. ONE definition for both readers — the settings
  // dialog (SettingsTogglesButton), which shows and flips all five, and the
  // Shop screen's read-only cards, which show two — so a switch flipped in the
  // dialog is reflected on the cards too.
  //
  // Both used to declare this key with their own fetch, and the Shop screen's
  // selected only its two columns. TanStack Query keeps one cache entry per
  // key and refetches it with whichever component's fetch rendered last, so a
  // refetch triggered while the Shop screen was open (closing the shop, a live
  // update) could replace the entry with the two-column answer — and the
  // dialog then showed its other three switches as off, whatever the
  // database said. Both readers now always get all five columns.
  //
  // notification_settings' RLS (migration 0023) scopes select and update to
  // the backoffice role; callers outside it pass `enabled: false`.
  notificationSettings() {
    return queryOptions({
      queryKey: shopPanelKeys.notificationSettings,
      queryFn: async (): Promise<NotificationSettingsRow> => {
        const { data, error } = await createClient()
          .from("notification_settings")
          .select(
            "whatsapp_enabled, notify_growers_on_business_day_open, shop_open_whatsapp_enabled, close_arrangement_customer_whatsapp_enabled, close_arrangement_grower_whatsapp_enabled",
          )
          .single();
        if (error) throw error;
        return data;
      },
    });
  },

  // The open shop's "customers see prices" flag, shown read-only in the
  // business-day panel. The caller decides when it may run (only while the
  // shop is open — see BusinessDayPanel).
  businessDayShop(dayId: string | undefined) {
    return queryOptions({
      queryKey: businessDayPanelKeys.shop(dayId),
      queryFn: async () => {
        const { data, error } = await createClient()
          .from("daily_shops")
          .select("can_see_prices")
          .eq("trading_day_id", dayId!)
          .single();
        if (error) throw error;
        return data;
      },
    });
  },
};
