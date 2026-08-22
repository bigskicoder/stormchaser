/**
 * Travelpayouts indicative fare enrichment (BUILD_PRIMER section 2.4).
 * Read-only cached "recently seen" pricing — NOT a live quote, NOT booking.
 * Must never block or delay alert firing (see lib/alerts/dispatch.ts, which
 * does not await this module).
 *
 * ASSUMPTION FLAG: same network constraint as the other ingestion modules —
 * built from documented Travelpayouts Data API conventions
 * (`/v1/prices/cheap`), not a live-validated response.
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
  data: Record<
    string,
    Record<
      string,
      Array<{
        price: number;
        airline: string;
        departure_at: string;
        return_at?: string;
      }>
    >
  >;
}

async function fetchCheapestFare(params: {
  origin: string;
  destination: string;
  token: string;
}): Promise<{ price: number; airline: string; departDate: string; returnDate: string | null } | null> {
  const url = new URL(`${TRAVELPAYOUTS_BASE_URL}/v1/prices/cheap`);
  url.searchParams.set("origin", params.origin);
  url.searchParams.set("destination", params.destination);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", params.token);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Travelpayouts request failed (${res.status})`);
  const body = (await res.json()) as CheapPricesResponse;

  const destEntry = body.data?.[params.destination];
  if (!destEntry) return null;
  const flights = Object.values(destEntry).flat();
  if (flights.length === 0) return null;

  const cheapest = flights.reduce((min, f) => (f.price < min.price ? f : min));
  return {
    price: cheapest.price,
    airline: cheapest.airline,
    departDate: cheapest.departure_at.slice(0, 10),
    returnDate: cheapest.return_at ? cheapest.return_at.slice(0, 10) : null,
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
