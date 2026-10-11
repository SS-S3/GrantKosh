import type { HttpClient } from "../core/http.js";
import type { Logger } from "../core/log.js";
import type { RawInvestor, RawOpportunity } from "../core/normalize.js";

export interface SourceContext {
  http: HttpClient;
  log: Logger;
  /** Run date (YYYY-MM-DD); every status is computed against it. */
  today: string;
  /** Directory for per-source incremental state (discovery indexes, enrichment cache). */
  stateDir: string;
  /** Cap on items per source, for quick test runs. */
  limit: number | null;
}

interface SourceBase {
  id: string;
  name: string;
  homepage: string;
  description: string;
}

export interface OpportunitySource extends SourceBase {
  kind: "opportunities";
  run(ctx: SourceContext): Promise<RawOpportunity[]>;
}

export interface InvestorSource extends SourceBase {
  kind: "investors";
  run(ctx: SourceContext): Promise<RawInvestor[]>;
}

export type Source = OpportunitySource | InvestorSource;
