/**
 * Resorts measured for true trail difficulty. Stowe is the pilot (Nick
 * knows it personally, so he can check the ranking); add others only after
 * it looks right.
 */
export interface DifficultyResortConfig {
  slug: string;
  name: string;
  /** south, west, north, east */
  bbox: [number, number, number, number];
  /** Pistes count only if inside a landuse=winter_sports area whose name matches. */
  areaName: RegExp;
  /** USGS 3DEP 1 m lidar project on prd-tnm.s3.amazonaws.com, and its UTM zone. */
  demProject: string;
  utmZone: number;
}

export const DIFFICULTY_RESORTS: DifficultyResortConfig[] = [
  {
    slug: "stowe",
    name: "Stowe",
    bbox: [44.505, -72.845, 44.565, -72.745],
    areaName: /stowe/i,
    demProject: "VT_Statewide_A23",
    utmZone: 18,
  },
];

export function difficultyResort(slug: string): DifficultyResortConfig | undefined {
  return DIFFICULTY_RESORTS.find((r) => r.slug === slug);
}
