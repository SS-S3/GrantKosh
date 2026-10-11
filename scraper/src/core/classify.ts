// Keyword taxonomy used to tag records with sectors, states, founder types and so on.
// Rules are whole-word regexes over title + summary (+ eligibility text when available).
import type { FundingType, ProgramType } from "./schema.js";
import { FOUNDER_TYPES, ENTITY_TYPES, REGISTRATIONS, STAGES } from "./schema.js";

type Rules<K extends string> = Array<[K, RegExp]>;

const w = (src: string) => new RegExp(`\\b(?:${src})\\b`, "i");

export const SECTOR_RULES: Rules<string> = [
  ["ai", w("ai|artificial intelligence|machine learning|ml|genai|generative ai|llms?|computer vision|nlp|data science")],
  ["agritech", w("agri\\w*|agricultur\\w*|farm(?:er|ers|ing)?|crops?|horticultur\\w*|fisher(?:y|ies)|aquacultur\\w*|dairy|livestock|animal husbandry|poultry|sericulture|plantation")],
  ["food-processing", w("food processing|food tech|foodtech|food products?|agro[- ]processing|beverages?")],
  ["biotech", w("biotech\\w*|biotechnology|bio-?e3|genomics?|life sciences?|synthetic biology|biomanufacturing|bio-?pharma\\w*|biologics")],
  ["healthtech", w("health\\w*|healthcare|medical|medicine|hospital|diagnostics?|pharma\\w*|clinical|wellness|ayush|telemedicine|disease")],
  ["medtech", w("medtech|medical devices?|med-?tech")],
  ["cleantech", w("clean ?tech|renewable\\w*|solar|wind energy|green hydrogen|hydrogen|energy storage|batter(?:y|ies)|energy efficiency|carbon")],
  ["climate", w("climate|sustainab\\w*|environment\\w*|circular economy|net[- ]zero|decarboni[sz]\\w*|biodiversity")],
  ["energy", w("energy|power sector|electricity|grid")],
  ["ev-mobility", w("ev|evs|electric vehicles?|e-?mobility|mobility|automotive|transport\\w*|charging infrastructure")],
  ["water", w("water|sanitation|wastewater|irrigation")],
  ["waste", w("waste management|recycl\\w*|plastic waste|e-?waste|solid waste")],
  ["defence", w("defen[cs]e|military|armed forces|army|navy|air force|dpsus?|idex|homeland security")],
  ["space", w("space ?tech|space sector|outer space|space technolog\\w*|satellites?|isro|in-?space|launch vehicles?|geospatial")],
  ["drones", w("drones?|uav|uas|unmanned aerial")],
  ["fintech", w("fintech|financial technology|payments?|banking|insurtech|insurance tech|lending tech|digital lending|upi")],
  ["edtech", w("edtech|ed-tech|e-?learning|education technology|skilling|schools?|teachers?")],
  ["deeptech", w("deep ?tech|frontier tech\\w*|quantum|photonics|nanotech\\w*|advanced materials?|robotics")],
  ["semiconductors", w("semiconductors?|chips?|vlsi|electronics design|esdm|fabless")],
  ["electronics", w("electronics?|hardware|embedded|iot|internet of things|sensors?")],
  ["it-software", w("software|saas|ites|information technology|it sector|it companies|cloud computing|mobile apps?|web3|blockchain")],
  ["cybersecurity", w("cyber ?security|cyber|infosec|information security")],
  ["telecom", w("telecom\\w*|5g|6g|wireless")],
  ["manufacturing", w("manufactur\\w*|industrial|make in india|factory|production linked|pli|machinery|capital goods")],
  ["textiles", w("textiles?|handlooms?|apparel|garments?|khadi|weav\\w*|silk|jute")],
  ["handicrafts", w("handicrafts?|artisans?|crafts?|cottage industr\\w*")],
  ["tourism", w("touris\\w*|hospitality|travel|homestays?|hotels?")],
  ["media-creative", w("media|films?|animation|gaming|avgc|creative industr\\w*|music|content creators?")],
  ["logistics", w("logistics|supply chain|warehous\\w*|shipping|ports?|maritime")],
  ["retail-ecommerce", w("retail|e-?commerce|d2c|consumer brands?|marketplace")],
  ["social-impact", w("social impact|social enterprise\\w*|livelihoods?|inclusion|underserved|ngos?|not[- ]for[- ]profit|csr|grassroots")],
  ["rural", w("rural|villages?|gram|panchayat|tribal")],
  ["smart-cities", w("smart cit(?:y|ies)|urban|municipal\\w*")],
];

export const INDIAN_STATES: Record<string, string> = {
  "andhra-pradesh": "Andhra Pradesh", "arunachal-pradesh": "Arunachal Pradesh", assam: "Assam", bihar: "Bihar",
  chhattisgarh: "Chhattisgarh", goa: "Goa", gujarat: "Gujarat", haryana: "Haryana", "himachal-pradesh": "Himachal Pradesh",
  jharkhand: "Jharkhand", karnataka: "Karnataka", kerala: "Kerala", "madhya-pradesh": "Madhya Pradesh", maharashtra: "Maharashtra",
  manipur: "Manipur", meghalaya: "Meghalaya", mizoram: "Mizoram", nagaland: "Nagaland", odisha: "Odisha", punjab: "Punjab",
  rajasthan: "Rajasthan", sikkim: "Sikkim", "tamil-nadu": "Tamil Nadu", telangana: "Telangana", tripura: "Tripura",
  "uttar-pradesh": "Uttar Pradesh", uttarakhand: "Uttarakhand", "west-bengal": "West Bengal",
  "andaman-nicobar": "Andaman & Nicobar Islands", chandigarh: "Chandigarh", "dadra-nagar-haveli-daman-diu": "Dadra & Nagar Haveli and Daman & Diu",
  delhi: "Delhi", "jammu-kashmir": "Jammu & Kashmir", ladakh: "Ladakh", lakshadweep: "Lakshadweep", puducherry: "Puducherry",
};

const STATE_ALIASES: Rules<string> = [
  ["andhra-pradesh", w("andhra pradesh|andhra|apsfl|ap innovation society")],
  ["arunachal-pradesh", w("arunachal(?: pradesh)?")],
  ["assam", w("assam|guwahati")],
  ["bihar", w("bihar|patna")],
  ["chhattisgarh", w("chhattisgarh|chattisgarh|raipur")],
  ["goa", w("goa")],
  ["gujarat", w("gujarat|gujarati|ahmedabad|gandhinagar|i-?hub gujarat|ssip")],
  ["haryana", w("haryana|gurugram|gurgaon")],
  ["himachal-pradesh", w("himachal(?: pradesh)?|shimla")],
  ["jharkhand", w("jharkhand|ranchi")],
  ["karnataka", w("karnataka|bengaluru|bangalore|kitven|elevate|kdem|mysuru|mysore")],
  ["kerala", w("kerala|ksum|kerala startup mission|kochi|thiruvananthapuram")],
  ["madhya-pradesh", w("madhya pradesh|bhopal|indore|mp startup")],
  ["maharashtra", w("maharashtra|mumbai|pune|nagpur|msins|maharashtra state innovation society")],
  ["manipur", w("manipur|imphal")],
  ["meghalaya", w("meghalaya|shillong")],
  ["mizoram", w("mizoram|aizawl")],
  ["nagaland", w("nagaland|kohima")],
  ["odisha", w("odisha|orissa|bhubaneswar|startup odisha")],
  ["punjab", w("punjab|ludhiana|mohali")],
  ["rajasthan", w("rajasthan|jaipur|istart")],
  ["sikkim", w("sikkim|gangtok")],
  ["tamil-nadu", w("tamil ?nadu|chennai|coimbatore|startuptn|edii[- ]?tn|tansim|tanseed")],
  ["telangana", w("telangana|hyderabad|t-?hub|we-?hub|t-?works")],
  ["tripura", w("tripura|agartala")],
  ["uttar-pradesh", w("uttar pradesh|lucknow|noida|kanpur|varanasi|startinup")],
  ["uttarakhand", w("uttarakhand|dehradun")],
  ["west-bengal", w("west bengal|kolkata|bengal")],
  ["andaman-nicobar", w("andaman|nicobar")],
  ["chandigarh", w("chandigarh")],
  ["dadra-nagar-haveli-daman-diu", w("dadra|nagar haveli|daman|diu")],
  ["delhi", w("delhi|new delhi|ncr")],
  ["jammu-kashmir", w("jammu|kashmir|j ?& ?k|srinagar")],
  ["ladakh", w("ladakh|leh")],
  ["lakshadweep", w("lakshadweep")],
  ["puducherry", w("puducherry|pondicherry")],
];

/** Map a free-form state name ("TAMIL NADU", "Jammu and Kashmir") to its slug. */
export function stateSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase().replace(/&/g, "and");
  if (/^(all|all states|pan[- ]india|india|national|central)$/.test(n)) return "pan-india";
  for (const [slug, label] of Object.entries(INDIAN_STATES)) if (label.toLowerCase().replace(/&/g, "and") === n) return slug;
  for (const [slug, re] of STATE_ALIASES) if (re.test(n)) return slug;
  return null;
}

const FOUNDER_RULES: Rules<(typeof FOUNDER_TYPES)[number]> = [
  ["women", w("wom[ae]n|female|mahila|girls?|ladies")],
  ["sc-st", w("sc ?/ ?st|scheduled castes?|scheduled tribes?|dalit|sc|st entrepreneurs?|tribal")],
  ["student", w("students?|undergraduates?|post-?graduates?|college|campus|university innovators?|phd scholars?|young innovators?")],
  ["researcher", w("researchers?|scientists?|faculty|academicians?|academic researchers?|research institutions?|phd|post-?docs?")],
  ["msme", w("msmes?|micro,? small|small and medium|smes?|small businesses?|micro enterprises?")],
  ["minority", w("minorit(?:y|ies)")],
  ["divyang", w("divyang\\w*|disabilit(?:y|ies)|differently[- ]abled|pwd|persons? with disabilit\\w*")],
  ["rural", w("rural|village|grassroots")],
  ["youth", w("youth|young entrepreneurs?|yuva|unemployed youth|educated unemployed")],
];

const REGISTRATION_RULES: Rules<(typeof REGISTRATIONS)[number]> = [
  ["dpiit", w("dpiit|startup india recogni[sz]\\w*|dpiit[- ]recogni[sz]ed|recogni[sz]ed startups?")],
  ["udyam", w("udyam|udyog aadhaar|msme registration")],
  ["incubated", w("incubat(?:ed|ees?)|incubation cent(?:er|re)s?|through an incubator|via incubators?")],
  ["gst", w("gst ?(?:registration|registered|number)|gstin")],
];

const ENTITY_RULES: Rules<(typeof ENTITY_TYPES)[number]> = [
  ["private-limited", w("private limited|pvt\\.? ltd|private companies|companies act|company incorporated|incorporated compan(?:y|ies)")],
  ["llp", w("llps?|limited liability partnerships?")],
  ["partnership", w("partnership firms?|registered partnerships?")],
  ["proprietorship", w("proprietorships?|sole proprietors?|proprietary concerns?")],
  ["individual", w("individuals?|individual innovators?|indian citizens?|applicants? aged")],
  ["ngo", w("ngos?|non-?profits?|section 8|trusts?|societ(?:y|ies) registered|civil society")],
  ["academic", w("academic institutions?|universit(?:y|ies)|colleges?|iits?|nits?|research institutions?|higher education institutions?")],
  ["cooperative", w("co-?operatives?|cooperative societ(?:y|ies)")],
  ["fpo", w("fpos?|farmer producer organi[sz]ations?|producer compan(?:y|ies)|shgs?|self[- ]help groups?")],
];

const STAGE_RULES: Rules<(typeof STAGES)[number]> = [
  ["idea", w("idea|ideation|concept|pre-?seed|proof of concept|poc|early[- ]stage|ignition|nascent")],
  ["prototype", w("prototyp\\w*|mvp|minimum viable|pilot|validation|trl ?[3-6]|product development|technology development")],
  ["early-revenue", w("early revenue|seed stage|seed fund\\w*|market entry|commerciali[sz]\\w*|go-to-market|first customers?|early traction|trl ?[7-8]")],
  ["growth", w("growth|scale-?up|scaling|expansion|series a|series b|late[- ]stage|trl ?9|established businesses?|existing enterprises?")],
];

function matchAll<K extends string>(rules: Rules<K>, text: string): K[] {
  const out: K[] = [];
  for (const [k, re] of rules) if (re.test(text) && !out.includes(k)) out.push(k);
  return out;
}

export const sectorsOf = (text: string) => matchAll(SECTOR_RULES, text);
export const foundersOf = (text: string) => matchAll(FOUNDER_RULES, text);
export const registrationsOf = (text: string) => matchAll(REGISTRATION_RULES, text);
export const entitiesOf = (text: string) => matchAll(ENTITY_RULES, text);
export const stagesOf = (text: string) => matchAll(STAGE_RULES, text);
export const statesOf = (text: string) => matchAll(STATE_ALIASES, text);

const PROGRAM_RULES: Rules<ProgramType> = [
  ["csr", w("csr|corporate social responsibility")],
  ["fellowship", w("fellowships?|fellows")],
  ["accelerator", w("accelerat\\w*|bootcamps?|cohorts?|launchpad|demo day")],
  ["incubation", w("incubat\\w*|pre-?incubation")],
  ["challenge", w("challenges?|hackathons?|competitions?|contest|grand challenge|problem statements?|innovation challenge|prize")],
  ["award", w("awards?")],
  ["loan", w("loans?|credit guarantee|credit facility|term loan|working capital|mudra|debt|refinanc\\w*|interest subvention")],
  ["subsidy", w("subsid(?:y|ies)|reimburse\\w*|capital investment subsidy|interest subsidy|incentives?|rebate|concession")],
  ["equity", w("equity investment|fund of funds|venture fund|seed capital investment|angel investment|convertible")],
  ["grant", w("grants?|grant-in-aid|non-dilutive|funding support|financial assistance|seed fund|call for proposals?|cfp")],
  ["scheme", w("schemes?|yojana|mission|policy|programme|program")],
];

/** First matching rule wins, so the list is ordered most-specific first. */
export function programTypeOf(text: string, fallback: ProgramType = "other"): ProgramType {
  for (const [k, re] of PROGRAM_RULES) if (re.test(text)) return k;
  return fallback;
}

export function fundingTypeOf(text: string, programType: ProgramType): FundingType {
  // "equity-free" / "no equity" / "non-dilutive" must not count as equity.
  const t = text.replace(/\b(equity[- ]free|no equity|without (?:taking )?equity|non-dilutive)\b/gi, " grant ");
  const has = (re: RegExp) => re.test(t);
  const grant = has(w("grants?|grant-in-aid|non-dilutive|equity[- ]free|prize money|cash prize|stipend"));
  const equity = has(w("equity|convertible|shares?|stake|investment of|invest(?:s|ing)? up to"));
  const debt = has(w("loans?|debt|credit|debentures?|repay\\w*"));
  const subsidy = has(w("subsid(?:y|ies)|reimburse\\w*|interest subvention|incentives?"));
  const kinds = [grant, equity, debt, subsidy].filter(Boolean).length;
  if (kinds > 1) return "mixed";
  if (grant) return programType === "challenge" || programType === "award" ? "prize" : "grant";
  if (equity) return "equity";
  if (debt) return "debt";
  if (subsidy) return "subsidy";
  switch (programType) {
    case "grant": case "fellowship": return "grant";
    case "challenge": case "award": return "prize";
    case "loan": return "debt";
    case "subsidy": return "subsidy";
    case "equity": return "equity";
    case "accelerator": case "incubation": return "in-kind";
    default: return "unknown";
  }
}

export function equityFreeOf(fundingType: FundingType, text: string): boolean | null {
  if (/\bequity[- ]free\b|\bnon-dilutive\b|\bno equity\b/i.test(text)) return true;
  if (fundingType === "equity") return false;
  if (["grant", "prize", "subsidy", "debt"].includes(fundingType)) return true;
  if (fundingType === "mixed") return /\bequity\b/i.test(text) ? false : true;
  return null;
}

export function rollingOf(text: string): boolean {
  return /\b(rolling|open throughout the year|throughout the year|round the year|all year|year-round|any ?time|ongoing basis|continuous(?:ly)? open|no deadline|open till funds)\b/i.test(text);
}
