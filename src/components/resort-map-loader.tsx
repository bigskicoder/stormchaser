"use client";

import dynamic from "next/dynamic";

/**
 * react-simple-maps computes marker/geography positions via d3-geo
 * projection math that can differ in its last couple of floating-point
 * digits between the server's render and the client's (observed directly:
 * a React hydration-mismatch warning on a <Marker> transform, e.g.
 * "74.61316437446504" server vs "74.6131643744651" client — functionally
 * identical, but React flags any SSR/client markup mismatch). The map is
 * already client-only interactive (pan/zoom/hover), so there's nothing to
 * gain from SSR-ing it; disabling SSR for just this component sidesteps
 * the mismatch entirely instead of fighting float precision.
 */
export const ResortMap = dynamic(() => import("./resort-map").then((m) => m.ResortMap), {
  ssr: false,
  loading: () => <div className="resort-map-wrap resort-map-loading" />,
});
