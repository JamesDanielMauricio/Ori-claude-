// Written out in full, one string per size, so Tailwind finds every class
// when it scans this file — a class assembled from pieces is never generated.
const HEIGHT = {
  // The phone header: 40px, the same row height as the bell and menu button.
  sm: "h-10",
  // The desktop sidebars.
  md: "h-14",
  // Above the sign-in card, where there is room for the small print to read.
  lg: "h-20",
} as const;

// The company logo, whole — mark, name and tagline — at the top of the
// sidebars and on the sign-in screens, standing alone (no product name beside
// it) and centred in the sidebars.
//
// Two transparent PNGs cut from the original (a JPEG on white), one per theme:
// the logo as drawn for light mode, and for dark mode a copy with the
// lettering lightened — the original's dark green is too dim on near-black.
// The three squares are identical in both.
//
// The theme picks the file in CSS, not here: globals.css points
// `--logo-image` at one or the other, re-pointed under <html data-theme>
// exactly like a colour token. So it follows the in-app theme choice, not just
// the device setting, and only the file on screen is downloaded. Both files
// sit in src/assets so the build gives them content-hashed names under
// /assets/ that browsers keep cached (public/ files are served `no-store`).
//
// A background image, since an <img> can't take its file from CSS — which is
// why this is a sized box: the height per `size`, the width from the logo's
// own proportions (563×320, the same in both files). `role="img"` and the
// label give it the meaning an <img> with alt text would have; the label is
// the logo's own words, since the image is the only place they appear.
export function LogoMark({ size = "md" }: { size?: keyof typeof HEIGHT }) {
  return (
    <span
      role="img"
      aria-label="LIOR HARPAZ Marketing Ltd."
      className={`block aspect-[563/320] shrink-0 bg-[image:var(--logo-image)] bg-contain bg-center bg-no-repeat ${HEIGHT[size]}`}
    />
  );
}
