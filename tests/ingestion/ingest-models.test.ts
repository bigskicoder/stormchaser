import { describe, expect, it } from "vitest";
import { hourlyModelsForUtcHour } from "@/lib/ingestion/ingest-models";

describe("hourlyModelsForUtcHour", () => {
  it("pulls GFS once per 6-hour GFS cycle and HRRR every hour", () => {
    const withGfs = Array.from({ length: 24 }, (_, h) => h).filter((h) => hourlyModelsForUtcHour(h).includes("gfs"));
    expect(withGfs).toEqual([5, 11, 17, 23]);
    for (let h = 0; h < 24; h++) expect(hourlyModelsForUtcHour(h)).toContain("hrrr");
  });
});
