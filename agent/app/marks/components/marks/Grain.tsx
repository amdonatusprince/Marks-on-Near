// From Moi (MIT): https://github.com/ramakrishnanhulk20/Moi. `fixed` covers the whole window.
const NOISE_TILE = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>" +
    "<filter id='n' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>" +
    "<feColorMatrix type='saturate' values='0'/>" +
    "</filter>" +
    "<rect width='100%' height='100%' filter='url(#n)'/></svg>",
);

/**
 * Film grain. Inside a hero section the section must be position: relative and clips the layer;
 * `fixed` lays it over the whole window instead.
 */
export function Grain({ fixed = false }: { fixed?: boolean }) {
  return (
    <div
      className={fixed ? "grain" : "hero-grain"}
      aria-hidden="true"
      style={{ backgroundImage: `url("data:image/svg+xml,${NOISE_TILE}")` }}
    />
  );
}
