// RGB of the --color-primary theme token (#16A34A) — kept as a literal triple
// since inline cell backgrounds need a computed rgba() string, not a static
// Tailwind class.
const PRIMARY_RGB = "22, 163, 74";

export function heatmapColor(intensity: number): string {
  return `rgba(${PRIMARY_RGB}, ${Math.max(0.06, intensity)})`;
}
