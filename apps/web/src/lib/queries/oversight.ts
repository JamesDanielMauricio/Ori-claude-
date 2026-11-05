import { queryOptions } from "@tanstack/react-query";

import { fetchAllRows } from "@/lib/fetch-all-rows";
import { createClient } from "@/lib/supabase/client";

// Server reads behind the two "on behalf of" oversight screens —
// /backoffice/distributor-grower ("בשם מגדל") and
// /backoffice/distributor-customer ("בשם לקוח") — each defined once, key +
// fetch together; see lib/queries/trading-day.ts for why the keys matter.

export const growerOversightKeys = {
  growerProductsAll: ["grower-oversight", "grower-products"] as const,
};

// ---------------------------------------------------------------- growers

export interface OversightGrower {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
  // Not shown on this screen — loaded only so the products dialog can send it
  // back unchanged (see lib/grower-products-save-input.ts).
  contact_person_id: string | null;
}

export interface PickLineRow {
  id: string;
  pallets_picked: number;
  leftover_pallets: number;
  comment: string | null;
  product_varieties: {
    id: string;
    name: string;
    sizes: string | null;
    family_id: string;
    product_families: { id: string; name: string; image_url: string | null } | null;
  } | null;
}

export interface DailyPickForDay {
  id: string;
  grower_company_id: string;
  status: "draft" | "submitted" | "closed";
  submitted_at: string | null;
  pickup_time: string | null;
  reminder_sent_at: string | null;
  daily_pick_products: PickLineRow[];
}

// ---------------------------------------------------------------- customers

export interface OversightCustomer {
  id: string;
  name: string;
  status: "active" | "inactive";
}

export interface OrderLineRow {
  id: string;
  pallets_ordered: number;
  comment: string | null;
  product_varieties: {
    id: string;
    name: string;
    sizes: string | null;
    family_id: string;
    product_families: { id: string; name: string; image_url: string | null } | null;
  } | null;
}

export interface DailyOrderForDay {
  id: string;
  customer_company_id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  reminder_sent_at: string | null;
  daily_order_products: OrderLineRow[];
}

export const oversightQueries = {
  // Active growers, one row each on the "בשם מגדל" screen.
  activeGrowers() {
    return queryOptions({
      queryKey: ["grower-oversight", "growers"],
      queryFn: async (): Promise<OversightGrower[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select(
            "id, name, status, default_pickup_time, whatsapp_group_id, transporter_company_id, contact_person_id",
          )
          .eq("type", "grower")
          .eq("status", "active")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  // Picks AND their lines in one request — embedding daily_pick_products
  // rather than a second query per expanded row, so opening a tenth grower's
  // chevron costs nothing this screen hasn't already paid for the first.
  picksForDay(dayId: string | undefined) {
    return queryOptions({
      queryKey: ["grower-oversight", "picks-for-day", dayId],
      enabled: !!dayId,
      queryFn: async (): Promise<DailyPickForDay[]> => {
        const { data, error } = await createClient()
          .from("daily_picks")
          .select(
            `id, grower_company_id, status, submitted_at, pickup_time, reminder_sent_at,
           daily_pick_products(id, pallets_picked, leftover_pallets, comment, product_varieties(id, name, sizes, family_id, product_families(id, name, image_url)))`,
          )
          .eq("trading_day_id", dayId!);
        if (error) throw error;
        return data;
      },
    });
  },

  // The whole catalog for the in-season products dialog.
  productCatalog() {
    return queryOptions({
      queryKey: ["grower-oversight", "product-catalog"],
      queryFn: async () => {
        // Paged for the same reason as growersWithProducts() below: the
        // catalog (~900 varieties) is near PostgREST's 1,000-row cap, which
        // truncates silently. `id` breaks ties between same-named varieties.
        return fetchAllRows<{
          id: string;
          name: string;
          sizes: string | null;
          product_families: { name: string } | null;
        }>((from, to) =>
          createClient()
            .from("product_varieties")
            .select("id, name, sizes, product_families(name)")
            .order("name")
            .order("id")
            .range(from, to),
        );
      },
    });
  },

  // Which growers have an in-season list at all — see
  // routes/backoffice/distributor-grower.tsx for why "no pick yet" needs
  // this to be told apart from "nothing in season".
  //
  // Paged (fetchAllRows) because grower_products is the table that outgrows
  // PostgREST's 1000-row cap, which truncates silently: past it, the growers
  // whose rows fell off the end would read as "no products in season".
  growersWithProducts() {
    return queryOptions({
      queryKey: ["grower-oversight", "growers-with-products"],
      queryFn: async () => {
        const rows = await fetchAllRows<{ company_id: string }>((from, to) =>
          createClient()
            .from("grower_products")
            .select("company_id")
            .order("company_id")
            .order("product_variety_id")
            .range(from, to),
        );
        return new Set(rows.map((row) => row.company_id));
      },
    });
  },

  // One grower's in-season list, for the products dialog opened on them.
  growerProducts(growerId: string | null) {
    return queryOptions({
      queryKey: ["grower-oversight", "grower-products", growerId],
      enabled: !!growerId,
      queryFn: async () => {
        const { data, error } = await createClient()
          .from("grower_products")
          .select("product_variety_id")
          .eq("company_id", growerId!);
        if (error) throw error;
        return data.map((row) => row.product_variety_id);
      },
    });
  },

  // Active customers, one row each on the "בשם לקוח" screen.
  activeCustomers() {
    return queryOptions({
      queryKey: ["customer-oversight", "customers"],
      queryFn: async (): Promise<OversightCustomer[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select("id, name, status")
          .eq("type", "customer")
          .eq("status", "active")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  // Orders AND their lines in one request — same reasoning as picksForDay():
  // embedding daily_order_products is what makes expanding any row free.
  ordersForDay(dayId: string | undefined) {
    return queryOptions({
      queryKey: ["customer-oversight", "orders-for-day", dayId],
      enabled: !!dayId,
      queryFn: async (): Promise<DailyOrderForDay[]> => {
        const { data, error } = await createClient()
          .from("daily_orders")
          .select(
            `id, customer_company_id, status, submitted_at, reminder_sent_at,
           daily_order_products(id, pallets_ordered, comment, product_varieties(id, name, sizes, family_id, product_families(id, name, image_url)))`,
          )
          .eq("trading_day_id", dayId!);
        if (error) throw error;
        return data;
      },
    });
  },
};
