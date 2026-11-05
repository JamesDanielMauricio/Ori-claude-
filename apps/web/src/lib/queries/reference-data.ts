import type { UserRole } from "@ori/shared/roles";
import { queryOptions } from "@tanstack/react-query";

import { fetchAllRows } from "@/lib/fetch-all-rows";
import { createClient } from "@/lib/supabase/client";

// Server reads behind the backoffice's reference-data screens (products,
// growers, customers, transporters, users) — the slow-changing records every
// trading day is built against. Each is defined once: key + fetch together
// (see lib/queries/trading-day.ts for why the keys matter).
//
// The four "…-all" join-table reads below are paged with fetchAllRows: each
// is read whole so a table can show one column per row without a query per
// row, and PostgREST silently truncates a single answer at 1,000 rows.

// ---------------------------------------------------------------- products

// The whole catalog as a pick-list (name + family) for chips and pickers —
// shared by the Growers and Users screens, which is why it has one key.
export interface CatalogVariety {
  id: string;
  name: string;
  sizes: string | null;
  product_families: { name: string } | null;
}

type PackType = "pallets" | "crates";

export interface ProductVariety {
  id: string;
  family_id: string;
  name: string;
  sizes: string | null;
  pack_type: PackType | null;
  price: number | null;
  price_range_from: number | null;
  price_range_to: number | null;
  price_type: string | null;
  no_overbooking: number;
  highlight_price_fluctuations: boolean;
  is_seasonal_available: boolean;
  number_of_orders_per_customer: number | null;
  version: number;
  created_at: string;
}

// The catalog's grouping level, and a record in its own right — the Products
// screen edits both halves. Fetched as its own list rather than read off each
// variety's embedded copy: a family with no varieties yet has no variety row
// to be embedded in, and it still needs a header row of its own to be renamed
// or photographed from.
export interface ProductFamily {
  id: string;
  name: string;
  category: string | null;
  image_url: string | null;
}

export interface PalletCap {
  customerCompanyId: string;
  palletCap: number;
}

// ---------------------------------------------------------------- companies

export interface GrowerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
  contact_person_id: string | null;
  created_at: string;
}

export interface TransporterOption {
  id: string;
  name: string;
}

export interface CustomerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  can_see_product_prices: boolean | null;
  whatsapp_group_id: string | null;
  contact_person_id: string | null;
  created_at: string;
}

export interface TransporterCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  whatsapp_group_id: string | null;
  contact_person_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- users

export interface ProfileRow {
  user_id: string;
  display_name: string;
  role: UserRole;
  company_id: string;
  // Optional editable field (reference/prd/edit-profile.md) and the source
  // of the individual-WhatsApp-dispatch batch when a company has no
  // whatsapp_group_id set — see profile.ts's schema comment. Not part of
  // `save_user`'s RPC signature (packages/db/migrations/0007), so saving it
  // is a plain `.update()` against `profiles` — already permitted by the
  // "profiles_update_backoffice" RLS policy (packages/db/migrations/0006),
  // no new function or migration required.
  phone_number: string | null;
  // True while the account is still on an admin-issued temporary password
  // (the PRD's "Temp Pass" state) — cleared by the client the moment the
  // user sets their own. Read-only here: it's set by the import/reset
  // flows, not something to toggle by hand.
  must_change_password: boolean;
  created_at: string;
  companies: { name: string } | null;
}

// One entry in the contact-person picker's directory.
export interface ContactPersonProfile {
  user_id: string;
  display_name: string;
  phone_number: string | null;
  companies: { name: string } | null;
}

export const referenceDataQueries = {
  productCatalog() {
    return queryOptions({
      queryKey: ["reference-data", "product-catalog"],
      queryFn: async () => {
        // Paged: the catalog (~900 varieties) is near PostgREST's 1,000-row
        // cap, and a truncated read would drop the varieties that sort last
        // from every chip and picker. `id` breaks ties between same-named
        // varieties so pages can't overlap.
        return fetchAllRows<CatalogVariety>((from, to) =>
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

  // Every variety with everything the Products screen edits.
  products() {
    return queryOptions({
      queryKey: ["reference-data", "products"],
      queryFn: async () => {
        // No embedded `product_families(...)` any more: the family's name,
        // category and photo are read from productFamilies(), so there is
        // one copy of each family on the Products screen rather than one per
        // variety — which also means a family edit doesn't leave ~600 stale
        // duplicates behind in this cache until it refetches.
        //
        // Paged (see fetchAllRows): the catalog is ~900 varieties, close to
        // PostgREST's 1,000-row cap, which cuts a longer answer short without
        // an error — past it, the varieties that sort last would quietly
        // vanish from this screen. `id` breaks ties between same-named
        // varieties so no row can land on two pages or none.
        return fetchAllRows<ProductVariety>((from, to) =>
          createClient()
            .from("product_varieties")
            .select(
              "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, number_of_orders_per_customer, version, created_at",
            )
            .order("name")
            .order("id")
            .range(from, to),
        );
      },
    });
  },

  productFamilies() {
    return queryOptions({
      queryKey: ["reference-data", "product-families"],
      queryFn: async (): Promise<ProductFamily[]> => {
        const { data, error } = await createClient()
          .from("product_families")
          .select("id, name, category, image_url")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  // Every variety's per-customer caps in ONE read, grouped client-side by
  // variety. No longer shown on the Products screen — read only so a save
  // sends each variety's existing caps back unchanged.
  productCustomerCaps() {
    return queryOptions({
      queryKey: ["reference-data", "product-customer-caps-all"],
      queryFn: async () => {
        const rows = await fetchAllRows<{
          product_variety_id: string;
          customer_company_id: string;
          pallet_cap: number;
        }>((from, to) =>
          createClient()
            .from("product_customer_caps")
            .select("product_variety_id, customer_company_id, pallet_cap")
            .order("product_variety_id")
            .order("customer_company_id")
            .range(from, to),
        );
        const byVariety = new Map<string, PalletCap[]>();
        for (const row of rows) {
          const cap = { customerCompanyId: row.customer_company_id, palletCap: row.pallet_cap };
          const list = byVariety.get(row.product_variety_id);
          if (list) list.push(cap);
          else byVariety.set(row.product_variety_id, [cap]);
        }
        return byVariety;
      },
    });
  },

  growers() {
    return queryOptions({
      queryKey: ["reference-data", "growers"],
      queryFn: async (): Promise<GrowerCompany[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select(
            "id, name, status, default_pickup_time, whatsapp_group_id, transporter_company_id, contact_person_id, created_at",
          )
          .eq("type", "grower")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  // Every grower's in-season selection in ONE read, grouped client-side by
  // company — not a query per row. The in-season list is a column, so every
  // visible row needs its own value; per-row queries would mean one request
  // per grower on first paint. This is the table that outgrows PostgREST's row
  // cap first.
  growerProducts() {
    return queryOptions({
      queryKey: ["reference-data", "grower-products-all"],
      queryFn: async () => {
        const rows = await fetchAllRows<{ company_id: string; product_variety_id: string }>(
          (from, to) =>
            createClient()
              .from("grower_products")
              .select("company_id, product_variety_id")
              .order("company_id")
              .order("product_variety_id")
              .range(from, to),
        );
        const byCompany = new Map<string, string[]>();
        for (const row of rows) {
          const list = byCompany.get(row.company_id);
          if (list) list.push(row.product_variety_id);
          else byCompany.set(row.company_id, [row.product_variety_id]);
        }
        return byCompany;
      },
    });
  },

  // Active transporters only — the Growers screen's "מוביל" dropdown assigns
  // the transporter that gets cc'd on a grower's arrangement-finalization
  // message (id 8, packages/db/migrations/0031/0033).
  transportersForGrowerAssignment() {
    return queryOptions({
      queryKey: ["reference-data", "transporters-for-grower-assignment"],
      queryFn: async (): Promise<TransporterOption[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select("id, name")
          .eq("type", "transporter")
          .eq("status", "active")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  customers() {
    return queryOptions({
      queryKey: ["reference-data", "customers"],
      queryFn: async (): Promise<CustomerCompany[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select(
            "id, name, status, can_see_product_prices, whatsapp_group_id, contact_person_id, created_at",
          )
          .eq("type", "customer")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  transporters() {
    return queryOptions({
      queryKey: ["reference-data", "transporters"],
      queryFn: async (): Promise<TransporterCompany[]> => {
        const { data, error } = await createClient()
          .from("companies")
          .select("id, name, status, whatsapp_group_id, contact_person_id, created_at")
          .eq("type", "transporter")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  users() {
    return queryOptions({
      queryKey: ["reference-data", "users"],
      queryFn: async (): Promise<ProfileRow[]> => {
        const { data, error } = await createClient()
          .from("profiles")
          .select(
            // `companies!company_id(...)`: profiles now has two FK paths to
            // companies (company_id, and the reverse via
            // companies.contact_person_id since migration 0057), so the bare
            // embed PostgREST used to infer on its own is ambiguous and
            // returns 300 — see auth-context.tsx's loadProfile for the fuller
            // note.
            "user_id, display_name, role, company_id, phone_number, must_change_password, created_at, companies!company_id(name)",
          )
          .order("display_name");
        if (error) throw error;
        return data;
      },
    });
  },

  // Every user's blocked-product selection in ONE read, grouped client-side by
  // user — same reasoning as growerProducts(): the blacklist is a column,
  // so every visible row needs its own value.
  blockedProducts() {
    return queryOptions({
      queryKey: ["reference-data", "blocked-products-all"],
      queryFn: async () => {
        const rows = await fetchAllRows<{ user_id: string; product_variety_id: string }>(
          (from, to) =>
            createClient()
              .from("profile_blocked_products")
              .select("user_id, product_variety_id")
              .order("user_id")
              .order("product_variety_id")
              .range(from, to),
        );
        const byUser = new Map<string, string[]>();
        for (const row of rows) {
          const list = byUser.get(row.user_id);
          if (list) list.push(row.product_variety_id);
          else byUser.set(row.user_id, [row.product_variety_id]);
        }
        return byUser;
      },
    });
  },

  // Every company, for the Users screen's company picker.
  companiesForUsers() {
    return queryOptions({
      queryKey: ["reference-data", "companies-for-users"],
      queryFn: async (): Promise<Array<{ id: string; name: string; type: string }>> => {
        const { data, error } = await createClient()
          .from("companies")
          .select("id, name, type")
          .order("name");
        if (error) throw error;
        return data;
      },
    });
  },

  // Every profile with its company name — the contact-person picker on the
  // Growers/Customers/Transporters screens (see useContactPersonDirectory).
  contactPersonProfiles() {
    return queryOptions({
      queryKey: ["reference-data", "contact-person-directory-profiles"],
      queryFn: async (): Promise<ContactPersonProfile[]> => {
        const { data, error } = await createClient()
          .from("profiles")
          // `companies!company_id(...)`, not the bare embed: profiles has two
          // FK paths to companies since this feature's own migration (0057
          // added companies.contact_person_id, a second FK back to profiles)
          // — see auth-context.tsx's loadProfile for the fuller note on why
          // the bare form 300s.
          .select("user_id, display_name, phone_number, companies!company_id(name)")
          .order("display_name");
        if (error) throw error;
        return data;
      },
    });
  },
};
