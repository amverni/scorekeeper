import type { StandingsDerivation, StandingsInput } from "../../types";
import { deriveGameReadModel } from "./gameReadModel";

export function deriveStandings(input: StandingsInput): StandingsDerivation {
  return deriveGameReadModel(input).standings;
}
