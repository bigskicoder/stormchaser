import { DEFAULT_SLR_STRATEGY } from "@/lib/config/constants";
import type { SlrStrategyName } from "@/lib/db/types";
import { cobbWaldstreicherStrategy } from "./cobb-waldstreicher.stub";
import { fixedRatioStrategy } from "./fixed-ratio";
import { kucheraStrategy } from "./kuchera";
import type { SlrStrategy } from "./types";

export type { SlrInput, SlrResult, SlrStrategy } from "./types";
export { FREEZING_POINT_C } from "./types";

const STRATEGIES: Record<SlrStrategyName, SlrStrategy> = {
  kuchera: kucheraStrategy,
  "fixed-ratio": fixedRatioStrategy,
  "cobb-waldstreicher": cobbWaldstreicherStrategy,
};

export function getSlrStrategy(name: SlrStrategyName = DEFAULT_SLR_STRATEGY): SlrStrategy {
  return STRATEGIES[name];
}
