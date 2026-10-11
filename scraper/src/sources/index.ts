import { birac } from "./birac.js";
import { curated } from "./curated.js";
import { discovered } from "./discovered.js";
import { euFunding } from "./eu-funding.js";
import { grantsGov } from "./grants-gov.js";
import { idex } from "./idex.js";
import { myscheme } from "./myscheme.js";
import { sebiAif } from "./sebi-aif.js";
import type { Source } from "./types.js";
import { ukri } from "./ukri.js";

/**
 * Registry, in dedupe priority order: when two sources describe the same program,
 * the one listed first wins and the others are recorded in `alsoListedOn`.
 */
export const SOURCES: Source[] = [curated, birac, idex, myscheme, ukri, euFunding, grantsGov, discovered, sebiAif];
