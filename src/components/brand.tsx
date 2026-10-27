// Two folded planes share a 30-degree delivery path. Keep this geometry in sync
// with public/brand/flowguard-mark.svg and the app icon.
export const markPath =
  "M48 8H106L93 30H60ZM33 36H56L50 46H85L72 68H37L23 92H0Z";

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 22 : 29}
      height={small ? 22 : 29}
      viewBox="-2 0 112 100"
      fill="none"
      aria-hidden="true"
    >
      <path d={markPath} fill="currentColor" />
    </svg>
  );
}
