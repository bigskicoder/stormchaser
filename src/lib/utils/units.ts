/** km/h to mph — used wherever the UI shows wind speed in US-conventional units; the data itself (forecast_pulls, snow_scores) stays metric throughout ingestion/scoring. */
export function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

/** Celsius to Fahrenheit — display-only, same reasoning as kmhToMph. */
export function cToF(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}
