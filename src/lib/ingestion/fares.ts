/**
 * Travelpayouts indicative fare enrichment (BUILD_PRIMER section 2.4).
 * Read-only cached "recently seen" pricing — NOT a live quote, NOT booking.
 * Must never block or delay alert firing (see lib/alerts/dispatch.ts, which
 * does not await this module).
 *
 * VERIFIED this session via WebSearch (api.travelpayouts.com itself is not
 * reachable from this sandbox — WebFetch returns EGRESS_BLOCKED for it same
 * as every other candidate domain — but WebSearch surfaced the actual
 * response shape documented at travelpayouts-data-api.readthedocs.io):
 * the response is `{success: boolean, data: Array<{origin, destination,
 * value, depart_date, return_date, ...}>}` — a FLAT ARRAY, not nested by
 * destination/flight-key as originally assumed. Field names also differ
 * from the original guess: `value` not `price`, `depart_date`/`return_date`
 * not `departure_at`/`return_at`. Fixed below. `airline` wasn't confirmed
 * in the search summary (the field list shown was value/depart_date/
 * return_date/number_of_changes/found_at/distance/actual/trip_class/
 * show_to_affiliates) — kept as optional and nullable rather than assumed
 * present, since section 2.4 treats this whole enrichment as optional
 * anyway.
 */

import { getServiceDb } from "@/lib/db/client";
import type { Resort } from "@/lib/db/types";

const TRAVELPAYOUTS_BASE_URL = "https://api.travelpayouts.com";

/**
 * Operator-supplied origin airport codes, per resort's nearest destination
 * airport. Data, not hardcoded logic — same pattern as the resort list
 * itself (section 2.4). Falls back to a shared major-city default list when
 * a resort has no resort-specific override, since most ski destinations
 * share the same handful of major US origin markets.
 */
const DEFAULT_ORIGIN_AIRPORTS = ["JFK", "LGA", "LAX", "ORD", "BOS", "IAH", "SFO", "DFW"];

/** Nearest commercial airport per resort, used as the `destination` param. Editable, not exhaustive. */
const RESORT_DESTINATION_AIRPORTS: Record<string, string> = {
  vail: "EGE",
  "beaver-creek": "EGE",
  breckenridge: "DEN",
  keystone: "DEN",
  "crested-butte": "GUC",
  "park-city": "SLC",
  heavenly: "RNO",
  northstar: "RNO",
  kirkwood: "RNO",
  "stevens-pass": "SEA",
  steamboat: "HDN",
  "winter-park": "DEN",
  "copper-mountain": "DEN",
  eldora: "DEN",
  "arapahoe-basin": "DEN",
  "aspen-mountain": "ASE",
  "aspen-highlands": "ASE",
  buttermilk: "ASE",
  snowmass: "ASE",
  "jackson-hole": "JAC",
  "big-sky": "BZN",
  "deer-valley": "SLC",
  solitude: "SLC",
  alta: "SLC",
  snowbird: "SLC",
  brighton: "SLC",
  "sun-valley": "SUN",
  "palisades-tahoe": "RNO",
  "mammoth-mountain": "MMH",
  "june-mountain": "MMH",
  "crystal-mountain-wa": "SEA",
  "taos-ski-valley": "TWF",
  schweitzer: "SFC",
  snowshoe: "CRW",
};

function destinationAirportFor(resort: Resort): string {
  return RESORT_DESTINATION_AIRPORTS[resort.slug] ?? "DEN";
}

interface CheapPricesResponse {
  success: boolean;
  data: Array<{
    origin: string;
    destination: string;
    value: number;
    depart_date: string;
    return_date?: string | null;
    airline?: string | null;
  }>;
}

async function fetchCheapestFare(params: {
  origin: string;
  destination: string;
  token: string;
}): Promise<{ price: number; airline: string | null; departDate: string; returnDate: string | null } | null> {
  const url = new URL(`${TRAVELPAYOUTS_BASE_URL}/v1/prices/cheap`);
  url.searchParams.set("origin", params.origin);
  url.searchParams.set("destination", params.destination);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", params.token);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Travelpayouts request failed (${res.status})`);
  const body = (await res.json()) as CheapPricesResponse;

  const flights = body.data ?? [];
  if (flights.length === 0) return null;

  const cheapest = flights.reduce((min, f) => (f.value < min.value ? f : min));
  return {
    price: cheapest.value,
    airline: cheapest.airline ?? null,
    departDate: cheapest.depart_date,
    returnDate: cheapest.return_date ?? null,
  };
}

export async function ingestFares(): Promise<{ written: number; skipped: number; errors: string[] }> {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) {
    return { written: 0, skipped: 0, errors: ["TRAVELPAYOUTS_TOKEN not set — skipping fare ingestion"] };
  }

  const db = getServiceDb();
  const { data, error } = await db.from("resorts").select("*").eq("active", true);
  if (error) throw error;
  const resorts = (data ?? []) as Resort[];

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const resort of resorts) {
    const destination = destinationAirportFor(resort);
    for (const origin of DEFAULT_ORIGIN_AIRPORTS) {
      try {
        const fare = await fetchCheapestFare({ origin, destination, token });
        if (!fare) {
          skipped += 1;
          continue;
        }
        const { error: insertError } = await db.from("fare_cache").insert({
          resort_id: resort.id,
          origin_airport_code: origin,
          price_usd: fare.price,
          airline: fare.airline,
          depart_date: fare.departDate,
          return_date: fare.returnDate,
        });
        if (insertError) throw insertError;
        written += 1;
      } catch (err) {
        errors.push(`${resort.slug}/${origin}: ${(err as Error).message}`);
      }
    }
  }

  return { written, skipped, errors };
}
