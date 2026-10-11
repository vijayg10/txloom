// RGB of the --color-primary theme token (#7C3AED) — kept as a literal triple
// since inline cell backgrounds need a computed rgba() string, not a static
// Tailwind class.
const PRIMARY_RGB = "124, 58, 237";

export function heatmapColor(intensity: number): string {
  return `rgba(${PRIMARY_RGB}, ${Math.max(0.06, intensity)})`;
}
