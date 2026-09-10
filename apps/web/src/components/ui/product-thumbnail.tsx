import { Icon } from "./icon";

// Round product photo, or a generic produce glyph while a family has no
// photo set yet — matching the reference design, where every product block
// is led by its picture.
//
// Lifted out of components/customer/order-product-list.tsx, where it was a
// local helper, once the arrangement board needed the identical treatment.
// Copying it would have been the third place in the app deciding for itself
// what "a product's picture" looks like; the photos are the same photos
// (product_families.image_url, migration 0036) and should read the same
// wherever they appear.
const SIZE_CLASSES = {
  // Inline with a variety row's text.
  sm: "h-8 w-8",
  // Leads a family header or a collapsed list row.
  md: "h-11 w-11",
} as const;

const GLYPH_CLASSES = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
} as const;

export function ProductThumbnail({
  imageUrl,
  size = "md",
}: {
  imageUrl?: string | null;
  size?: keyof typeof SIZE_CLASSES;
}) {
  // The ring sits *inside* the element (`ring-inset`) so a photo's own edge
  // isn't clipped by a border drawn on top of it. The hover scale is keyed
  // off an ancestor `.group`; where there is no such ancestor it simply
  // never fires, which is why this is safe to drop into a static header.
  const shared = `shrink-0 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] group-hover:scale-105 ${SIZE_CLASSES[size]}`;

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        // `loading="lazy"` because a long catalog would otherwise fetch every
        // family's photo before the first row is interactive.
        loading="lazy"
        className={`${shared} object-cover shadow-card ring-1 ring-inset ring-border`}
      />
    );
  }

  return (
    <span
      className={`${shared} flex items-center justify-center bg-gradient-to-br from-accent-soft to-accent-soft/50 text-accent ring-1 ring-inset ring-accent/15`}
    >
      <Icon name="leaf" className={GLYPH_CLASSES[size]} />
    </span>
  );
}
