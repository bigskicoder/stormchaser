/**
 * Seed data for the `resorts` table: the full US Epic Pass + Ikon Pass
 * roster (per operator direction — see BUILD_PRIMER section 9 resolution).
 *
 * IMPORTANT — data confidence: lat/lng/elevation values here are compiled
 * from general training knowledge, not queried live from an authoritative
 * source. They are NOT trusted as-is. Every row is seeded with
 * elevation_check_flag = false / elevation_checked_at = null, and
 * `scripts/seed-resorts.ts` runs each one through the Open-Meteo Elevation
 * API onboarding check (BUILD_PRIMER section 2.1a) immediately after
 * insert — any row whose actual DEM elevation differs from the seeded
 * value by >150m at any band gets elevation_check_flag = true and must be
 * manually reviewed before the resort is trusted for scoring. `mid`
 * elevation is a straight base/summit midpoint interpolation except where
 * noted, since Open-Meteo has no native "mid-mountain" concept — it's a
 * reasonable operator-editable default, not a precision figure.
 *
 * Architecture requirement (primer section 10.5 / section 9): this list is
 * data, not code path logic. Adding/editing/deleting resorts happens via
 * the `resorts` table directly (Supabase Studio, admin tooling, or a future
 * CRUD screen) — never by touching application code.
 */

export type PassAffiliation = "epic" | "ikon" | "independent" | "none";

export interface ResortSeed {
  slug: string;
  name: string;
  pass_affiliation: PassAffiliation;
  state: string;
  lat: number;
  lng: number;
  elevation_base_m: number;
  elevation_mid_m: number;
  elevation_summit_m: number;
  timezone: string;
}

const mid = (base: number, summit: number) => Math.round((base + summit) / 2);

const MT = "America/Denver";
const PT = "America/Los_Angeles";
const ET = "America/New_York";
const CT = "America/Chicago";

export const RESORTS_SEED: ResortSeed[] = [
  // ---- EPIC PASS (Vail Resorts) — Western destination ----
  { slug: "vail", name: "Vail", pass_affiliation: "epic", state: "CO", lat: 39.6403, lng: -106.3742, elevation_base_m: 2500, elevation_mid_m: mid(2500, 3527), elevation_summit_m: 3527, timezone: MT },
  { slug: "beaver-creek", name: "Beaver Creek", pass_affiliation: "epic", state: "CO", lat: 39.6042, lng: -106.5165, elevation_base_m: 2225, elevation_mid_m: mid(2225, 3488), elevation_summit_m: 3488, timezone: MT },
  { slug: "breckenridge", name: "Breckenridge", pass_affiliation: "epic", state: "CO", lat: 39.4817, lng: -106.0384, elevation_base_m: 2926, elevation_mid_m: mid(2926, 3914), elevation_summit_m: 3914, timezone: MT },
  { slug: "keystone", name: "Keystone", pass_affiliation: "epic", state: "CO", lat: 39.6084, lng: -105.9439, elevation_base_m: 2835, elevation_mid_m: mid(2835, 3782), elevation_summit_m: 3782, timezone: MT },
  { slug: "crested-butte", name: "Crested Butte", pass_affiliation: "epic", state: "CO", lat: 38.8697, lng: -106.9878, elevation_base_m: 2775, elevation_mid_m: mid(2775, 3706), elevation_summit_m: 3706, timezone: MT },
  { slug: "park-city", name: "Park City Mountain", pass_affiliation: "epic", state: "UT", lat: 40.6514, lng: -111.508, elevation_base_m: 2103, elevation_mid_m: mid(2103, 3049), elevation_summit_m: 3049, timezone: MT },
  { slug: "heavenly", name: "Heavenly", pass_affiliation: "epic", state: "CA", lat: 38.9353, lng: -119.94, elevation_base_m: 1996, elevation_mid_m: mid(1996, 3060), elevation_summit_m: 3060, timezone: PT },
  { slug: "northstar", name: "Northstar", pass_affiliation: "epic", state: "CA", lat: 39.2746, lng: -120.1211, elevation_base_m: 1930, elevation_mid_m: mid(1930, 2625), elevation_summit_m: 2625, timezone: PT },
  { slug: "kirkwood", name: "Kirkwood", pass_affiliation: "epic", state: "CA", lat: 38.685, lng: -120.0654, elevation_base_m: 2377, elevation_mid_m: mid(2377, 2987), elevation_summit_m: 2987, timezone: PT },
  { slug: "stevens-pass", name: "Stevens Pass", pass_affiliation: "epic", state: "WA", lat: 47.7448, lng: -121.089, elevation_base_m: 1240, elevation_mid_m: mid(1240, 1780), elevation_summit_m: 1780, timezone: PT },

  // ---- EPIC PASS — Northeast ----
  { slug: "okemo", name: "Okemo", pass_affiliation: "epic", state: "VT", lat: 43.4009, lng: -72.7166, elevation_base_m: 494, elevation_mid_m: mid(494, 951), elevation_summit_m: 951, timezone: ET },
  { slug: "mount-snow", name: "Mount Snow", pass_affiliation: "epic", state: "VT", lat: 42.9601, lng: -72.9207, elevation_base_m: 566, elevation_mid_m: mid(566, 1101), elevation_summit_m: 1101, timezone: ET },
  { slug: "stowe", name: "Stowe", pass_affiliation: "epic", state: "VT", lat: 44.5305, lng: -72.7815, elevation_base_m: 402, elevation_mid_m: mid(402, 1339), elevation_summit_m: 1339, timezone: ET },
  { slug: "hunter-mountain", name: "Hunter Mountain", pass_affiliation: "epic", state: "NY", lat: 42.2029, lng: -74.2296, elevation_base_m: 549, elevation_mid_m: mid(549, 975), elevation_summit_m: 975, timezone: ET },
  { slug: "windham", name: "Windham Mountain", pass_affiliation: "ikon", state: "NY", lat: 42.3126, lng: -74.2554, elevation_base_m: 549, elevation_mid_m: mid(549, 945), elevation_summit_m: 945, timezone: ET },
  { slug: "wildcat", name: "Wildcat Mountain", pass_affiliation: "epic", state: "NH", lat: 44.2634, lng: -71.2394, elevation_base_m: 640, elevation_mid_m: mid(640, 1250), elevation_summit_m: 1250, timezone: ET },
  { slug: "attitash", name: "Attitash", pass_affiliation: "epic", state: "NH", lat: 44.0837, lng: -71.2298, elevation_base_m: 183, elevation_mid_m: mid(183, 610), elevation_summit_m: 610, timezone: ET },
  { slug: "crotched-mountain", name: "Crotched Mountain", pass_affiliation: "epic", state: "NH", lat: 42.9836, lng: -71.8862, elevation_base_m: 305, elevation_mid_m: mid(305, 610), elevation_summit_m: 610, timezone: ET },

  // ---- EPIC PASS — Mid-Atlantic (former Peak Resorts) ----
  { slug: "liberty-mountain", name: "Liberty Mountain", pass_affiliation: "epic", state: "PA", lat: 39.7462, lng: -77.3494, elevation_base_m: 268, elevation_mid_m: mid(268, 457), elevation_summit_m: 457, timezone: ET },
  { slug: "roundtop-mountain", name: "Roundtop Mountain", pass_affiliation: "epic", state: "PA", lat: 40.1237, lng: -76.9161, elevation_base_m: 229, elevation_mid_m: mid(229, 421), elevation_summit_m: 421, timezone: ET },
  { slug: "whitetail", name: "Whitetail", pass_affiliation: "epic", state: "PA", lat: 39.7223, lng: -77.6883, elevation_base_m: 305, elevation_mid_m: mid(305, 594), elevation_summit_m: 594, timezone: ET },
  { slug: "jack-frost", name: "Jack Frost", pass_affiliation: "epic", state: "PA", lat: 41.0765, lng: -75.6535, elevation_base_m: 421, elevation_mid_m: mid(421, 610), elevation_summit_m: 610, timezone: ET },
  { slug: "big-boulder", name: "Big Boulder", pass_affiliation: "epic", state: "PA", lat: 41.0631, lng: -75.6001, elevation_base_m: 396, elevation_mid_m: mid(396, 549), elevation_summit_m: 549, timezone: ET },
  { slug: "seven-springs", name: "Seven Springs", pass_affiliation: "epic", state: "PA", lat: 40.0223, lng: -79.2945, elevation_base_m: 671, elevation_mid_m: mid(671, 838), elevation_summit_m: 838, timezone: ET },
  { slug: "hidden-valley-pa", name: "Hidden Valley (PA)", pass_affiliation: "epic", state: "PA", lat: 40.0084, lng: -79.3711, elevation_base_m: 670, elevation_mid_m: mid(670, 823), elevation_summit_m: 823, timezone: ET },
  { slug: "laurel-mountain", name: "Laurel Mountain", pass_affiliation: "epic", state: "PA", lat: 40.1934, lng: -79.1197, elevation_base_m: 610, elevation_mid_m: mid(610, 793), elevation_summit_m: 793, timezone: ET },

  // ---- EPIC PASS — Midwest ----
  { slug: "afton-alps", name: "Afton Alps", pass_affiliation: "epic", state: "MN", lat: 44.8305, lng: -92.7891, elevation_base_m: 213, elevation_mid_m: mid(213, 305), elevation_summit_m: 305, timezone: CT },
  { slug: "mt-brighton", name: "Mt. Brighton", pass_affiliation: "epic", state: "MI", lat: 42.5378, lng: -83.818, elevation_base_m: 275, elevation_mid_m: mid(275, 335), elevation_summit_m: 335, timezone: ET },
  { slug: "wilmot-mountain", name: "Wilmot Mountain", pass_affiliation: "epic", state: "WI", lat: 42.5089, lng: -88.1878, elevation_base_m: 245, elevation_mid_m: mid(245, 300), elevation_summit_m: 300, timezone: CT },
  { slug: "paoli-peaks", name: "Paoli Peaks", pass_affiliation: "epic", state: "IN", lat: 38.5461, lng: -86.4778, elevation_base_m: 200, elevation_mid_m: mid(200, 260), elevation_summit_m: 260, timezone: ET },
  { slug: "hidden-valley-mo", name: "Hidden Valley (MO)", pass_affiliation: "epic", state: "MO", lat: 38.4956, lng: -90.6584, elevation_base_m: 150, elevation_mid_m: mid(150, 215), elevation_summit_m: 215, timezone: CT },
  { slug: "snow-creek", name: "Snow Creek", pass_affiliation: "epic", state: "MO", lat: 39.3673, lng: -94.533, elevation_base_m: 250, elevation_mid_m: mid(250, 300), elevation_summit_m: 300, timezone: CT },

  // ---- IKON PASS (Alterra-owned) — Western destination ----
  { slug: "steamboat", name: "Steamboat", pass_affiliation: "ikon", state: "CO", lat: 40.4572, lng: -106.8045, elevation_base_m: 2103, elevation_mid_m: mid(2103, 3221), elevation_summit_m: 3221, timezone: MT },
  { slug: "winter-park", name: "Winter Park", pass_affiliation: "ikon", state: "CO", lat: 39.8868, lng: -105.7625, elevation_base_m: 2743, elevation_mid_m: mid(2743, 3676), elevation_summit_m: 3676, timezone: MT },
  { slug: "copper-mountain", name: "Copper Mountain", pass_affiliation: "ikon", state: "CO", lat: 39.5022, lng: -106.1511, elevation_base_m: 2926, elevation_mid_m: mid(2926, 3763), elevation_summit_m: 3763, timezone: MT },
  { slug: "eldora", name: "Eldora", pass_affiliation: "ikon", state: "CO", lat: 39.9375, lng: -105.5828, elevation_base_m: 2896, elevation_mid_m: mid(2896, 3323), elevation_summit_m: 3323, timezone: MT },
  { slug: "arapahoe-basin", name: "Arapahoe Basin", pass_affiliation: "ikon", state: "CO", lat: 39.6425, lng: -105.8719, elevation_base_m: 3286, elevation_mid_m: mid(3286, 3978), elevation_summit_m: 3978, timezone: MT },
  { slug: "aspen-mountain", name: "Aspen Mountain", pass_affiliation: "ikon", state: "CO", lat: 39.1867, lng: -106.8175, elevation_base_m: 2405, elevation_mid_m: mid(2405, 3417), elevation_summit_m: 3417, timezone: MT },
  { slug: "aspen-highlands", name: "Aspen Highlands", pass_affiliation: "ikon", state: "CO", lat: 39.1789, lng: -106.848, elevation_base_m: 2438, elevation_mid_m: mid(2438, 3595), elevation_summit_m: 3595, timezone: MT },
  { slug: "buttermilk", name: "Buttermilk", pass_affiliation: "ikon", state: "CO", lat: 39.1997, lng: -106.86, elevation_base_m: 2409, elevation_mid_m: mid(2409, 3025), elevation_summit_m: 3025, timezone: MT },
  { slug: "snowmass", name: "Snowmass", pass_affiliation: "ikon", state: "CO", lat: 39.2115, lng: -106.9378, elevation_base_m: 2473, elevation_mid_m: mid(2473, 3813), elevation_summit_m: 3813, timezone: MT },
  { slug: "jackson-hole", name: "Jackson Hole", pass_affiliation: "ikon", state: "WY", lat: 43.5875, lng: -110.828, elevation_base_m: 1924, elevation_mid_m: mid(1924, 3185), elevation_summit_m: 3185, timezone: MT },
  { slug: "big-sky", name: "Big Sky", pass_affiliation: "ikon", state: "MT", lat: 45.2846, lng: -111.4008, elevation_base_m: 2286, elevation_mid_m: mid(2286, 3402), elevation_summit_m: 3402, timezone: MT },
  { slug: "deer-valley", name: "Deer Valley", pass_affiliation: "ikon", state: "UT", lat: 40.6374, lng: -111.4783, elevation_base_m: 2003, elevation_mid_m: mid(2003, 2913), elevation_summit_m: 2913, timezone: MT },
  { slug: "solitude", name: "Solitude", pass_affiliation: "ikon", state: "UT", lat: 40.6199, lng: -111.5924, elevation_base_m: 2438, elevation_mid_m: mid(2438, 3160), elevation_summit_m: 3160, timezone: MT },
  { slug: "alta", name: "Alta", pass_affiliation: "ikon", state: "UT", lat: 40.5883, lng: -111.6386, elevation_base_m: 2600, elevation_mid_m: mid(2600, 3215), elevation_summit_m: 3215, timezone: MT },
  { slug: "snowbird", name: "Snowbird", pass_affiliation: "ikon", state: "UT", lat: 40.582, lng: -111.6558, elevation_base_m: 2365, elevation_mid_m: mid(2365, 3353), elevation_summit_m: 3353, timezone: MT },
  { slug: "brighton", name: "Brighton", pass_affiliation: "ikon", state: "UT", lat: 40.5977, lng: -111.5836, elevation_base_m: 2673, elevation_mid_m: mid(2673, 3277), elevation_summit_m: 3277, timezone: MT },
  { slug: "sun-valley", name: "Sun Valley", pass_affiliation: "ikon", state: "ID", lat: 43.6975, lng: -114.3517, elevation_base_m: 1755, elevation_mid_m: mid(1755, 2789), elevation_summit_m: 2789, timezone: MT },
  { slug: "palisades-tahoe", name: "Palisades Tahoe", pass_affiliation: "ikon", state: "CA", lat: 39.1969, lng: -120.2358, elevation_base_m: 1889, elevation_mid_m: mid(1889, 2743), elevation_summit_m: 2743, timezone: PT },
  { slug: "mammoth-mountain", name: "Mammoth Mountain", pass_affiliation: "ikon", state: "CA", lat: 37.6308, lng: -119.0326, elevation_base_m: 2424, elevation_mid_m: mid(2424, 3369), elevation_summit_m: 3369, timezone: PT },
  { slug: "june-mountain", name: "June Mountain", pass_affiliation: "ikon", state: "CA", lat: 37.7669, lng: -119.085, elevation_base_m: 2317, elevation_mid_m: mid(2317, 3090), elevation_summit_m: 3090, timezone: PT },
  { slug: "crystal-mountain-wa", name: "Crystal Mountain", pass_affiliation: "ikon", state: "WA", lat: 46.9282, lng: -121.4747, elevation_base_m: 1341, elevation_mid_m: mid(1341, 2134), elevation_summit_m: 2134, timezone: PT },
  { slug: "taos-ski-valley", name: "Taos Ski Valley", pass_affiliation: "ikon", state: "NM", lat: 36.596, lng: -105.4524, elevation_base_m: 2804, elevation_mid_m: mid(2804, 3804), elevation_summit_m: 3804, timezone: MT },
  { slug: "schweitzer", name: "Schweitzer", pass_affiliation: "ikon", state: "ID", lat: 48.367, lng: -116.6222, elevation_base_m: 1219, elevation_mid_m: mid(1219, 1963), elevation_summit_m: 1963, timezone: PT },
  { slug: "snowshoe", name: "Snowshoe", pass_affiliation: "ikon", state: "WV", lat: 38.4128, lng: -79.9958, elevation_base_m: 1225, elevation_mid_m: mid(1225, 1465), elevation_summit_m: 1465, timezone: ET },
  { slug: "mountain-high", name: "Mountain High", pass_affiliation: "ikon", state: "CA", lat: 34.3739, lng: -117.6947, elevation_base_m: 2103, elevation_mid_m: mid(2103, 2591), elevation_summit_m: 2591, timezone: PT },
  { slug: "snow-valley", name: "Snow Valley", pass_affiliation: "ikon", state: "CA", lat: 34.2233, lng: -117.035, elevation_base_m: 2103, elevation_mid_m: mid(2103, 2438), elevation_summit_m: 2438, timezone: PT },

  // ---- IKON PASS — Northeast ----
  { slug: "sugarbush", name: "Sugarbush", pass_affiliation: "ikon", state: "VT", lat: 44.1359, lng: -72.8925, elevation_base_m: 561, elevation_mid_m: mid(561, 1244), elevation_summit_m: 1244, timezone: ET },
  { slug: "stratton", name: "Stratton", pass_affiliation: "ikon", state: "VT", lat: 43.1139, lng: -72.9082, elevation_base_m: 579, elevation_mid_m: mid(579, 1177), elevation_summit_m: 1177, timezone: ET },
  { slug: "killington", name: "Killington", pass_affiliation: "ikon", state: "VT", lat: 43.6045, lng: -72.8201, elevation_base_m: 384, elevation_mid_m: mid(384, 1293), elevation_summit_m: 1293, timezone: ET },
  { slug: "pico-mountain", name: "Pico Mountain", pass_affiliation: "ikon", state: "VT", lat: 43.6659, lng: -72.8384, elevation_base_m: 549, elevation_mid_m: mid(549, 1195), elevation_summit_m: 1195, timezone: ET },
  { slug: "loon-mountain", name: "Loon Mountain", pass_affiliation: "ikon", state: "NH", lat: 44.0359, lng: -71.6216, elevation_base_m: 305, elevation_mid_m: mid(305, 975), elevation_summit_m: 975, timezone: ET },

  // ---- IKON PASS — Midwest ----
  { slug: "boyne-mountain", name: "Boyne Mountain", pass_affiliation: "ikon", state: "MI", lat: 45.1614, lng: -84.833, elevation_base_m: 229, elevation_mid_m: mid(229, 421), elevation_summit_m: 421, timezone: ET },
  { slug: "boyne-highlands", name: "Boyne Highlands", pass_affiliation: "ikon", state: "MI", lat: 45.4886, lng: -84.9522, elevation_base_m: 229, elevation_mid_m: mid(229, 445), elevation_summit_m: 445, timezone: ET },
];
