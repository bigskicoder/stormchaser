"use client";

import { useRouter } from "next/navigation";
import { RadarPanel, type RadarPin } from "@/components/radar-panel";

/** Resort page radar: clicking a neighbor's pin opens that resort's page. */
export function ResortRadar({ resort, pins }: { resort: RadarPin; pins: RadarPin[] }) {
  const router = useRouter();
  return (
    <RadarPanel
      center={{ lat: resort.lat, lng: resort.lng }}
      pins={pins}
      selectedSlug={resort.slug}
      onSelect={(slug) => {
        if (slug !== resort.slug) router.push(`/resorts/${slug}`);
      }}
      title={`Radar around ${resort.name}`}
      subtitle="Tap a nearby resort to open its forecast."
    />
  );
}
