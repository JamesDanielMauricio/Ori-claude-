-- Storage backing for product_families.image_url (migration 0036). Until now
-- that column could only be filled by pasting a URL into a text box — this
-- adds the bucket + policies so the backoffice screen can upload a photo
-- from disk instead. No table/column changes: the upload just produces a
-- public URL that gets written into the column exactly the way a pasted one
-- already did, so nothing downstream (ProductThumbnail, the customer catalog
-- RPC) needs to change.
--
-- `on conflict do nothing` / `drop policy if exists`: this app has already
-- been bitten once by a migration that failed partway through and needed a
-- safe retry (see 0036's own comment) — same precaution here.

-- SECURITY: bucket is public (readable by anyone with the URL, no auth
-- required) — matching what 0036 already documented as the intended shape
-- ("Optional public URL of a product photo"). This is a produce catalog
-- photo shown to every role including customers on the order screen, not
-- sensitive data, so there is nothing a public URL leaks that RLS would
-- otherwise have protected. `file_size_limit` and `allowed_mime_types` are
-- enforced by Storage itself on every upload — a backstop behind the
-- client-side check in product-catalog-screen.tsx, since a client-side-only
-- check is trivially bypassed (e.g. calling the Storage API directly) and
-- would otherwise let a single upload consume an unbounded, and billable,
-- amount of Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-photos',
  'product-photos',
  true,
  5242880, -- 5 MiB: a catalog thumbnail has no reason to need more.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- No `grant` statements: unlike our own `public` schema tables (0003, 0006),
-- Supabase's storage.objects table already ships with select/insert/update/
-- delete granted to `anon`/`authenticated` at install time — RLS is what
-- actually gates access, which is all these two policies add.

drop policy if exists "product_photos_select_authenticated" on storage.objects;

-- Read access via the authenticated Storage API (e.g. a future `.list()` or
-- `.download()` call). Separate from the bucket's `public` flag above, which
-- only governs the direct `/object/public/...` URL every viewer's <img> tag
-- actually uses — this policy is what would gate any other SDK read path.
create policy "product_photos_select_authenticated" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'product-photos');

drop policy if exists "product_photos_write_backoffice" on storage.objects;

-- Only backoffice may upload, replace, or delete a product photo — the same
-- rule product_families_write_backoffice (0006) already enforces for the
-- row the photo's URL lives on. Without this, RLS defaults to "no access",
-- so a grower or customer session calling the Storage API directly (not
-- through this app's UI, which never offers them the control) would already
-- be refused even before this policy exists; this is what lets backoffice
-- back in.
create policy "product_photos_write_backoffice" on storage.objects
  for all
  to authenticated
  using (bucket_id = 'product-photos' and public.current_role() = 'backoffice')
  with check (bucket_id = 'product-photos' and public.current_role() = 'backoffice');
