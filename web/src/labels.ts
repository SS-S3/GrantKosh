import type { Country, FundingType, InvestorKind, Opportunity, ProgramType, Status } from "./types";

export const PROGRAM_TYPE: Record<ProgramType, string> = {
  grant: "Grant", scheme: "Govt. scheme", challenge: "Challenge", accelerator: "Accelerator", incubation: "Incubation",
  fellowship: "Fellowship", loan: "Loan", subsidy: "Subsidy", equity: "Equity / fund", award: "Award", csr: "CSR", other: "Other",
};
export const FUNDING_TYPE: Record<FundingType, string> = {
  grant: "Grant (equity-free)", equity: "Equity", debt: "Debt / loan", subsidy: "Subsidy", prize: "Prize money",
  "in-kind": "In-kind support", mixed: "Mixed", unknown: "Not stated",
};
export const STAGE: Record<Opportunity["stages"][number], string> = { idea: "Idea", prototype: "Prototype / MVP", "early-revenue": "Early revenue", growth: "Growth" };
export const FOUNDER: Record<Opportunity["founderTypes"][number], string> = {
  women: "Women", "sc-st": "SC/ST", student: "Students", researcher: "Researchers / faculty", msme: "MSMEs",
  minority: "Minority", divyang: "Persons with disability", rural: "Rural", youth: "Youth",
};
export const REGISTRATION: Record<Opportunity["registrations"][number], string> = {
  dpiit: "DPIIT recognition", udyam: "Udyam (MSME)", incubated: "Incubated", gst: "GST registration",
};
export const ENTITY: Record<Opportunity["entityTypes"][number], string> = {
  "private-limited": "Private limited", llp: "LLP", partnership: "Partnership", proprietorship: "Proprietorship",
  individual: "Individual", ngo: "NGO / Section 8", academic: "Academic institution", cooperative: "Cooperative", fpo: "FPO / SHG",
};
export const STATUS: Record<Status, string> = { open: "Open", upcoming: "Opening soon", rolling: "Rolling", closed: "Closed", unknown: "Check dates" };
export const COUNTRY: Record<Country, string> = { IN: "India", US: "United States", GB: "United Kingdom", EU: "European Union", INT: "International" };
export const INVESTOR_KIND: Record<InvestorKind, string> = {
  "angel-fund": "Angel fund", "venture-capital": "Venture capital", "private-equity": "Private equity", "venture-debt": "Venture debt / credit",
  hedge: "Hedge / Cat III", "social-impact": "Social impact", infrastructure: "Infrastructure", sme: "SME fund", "fund-of-funds": "Fund of funds", other: "Other",
};

export const SECTOR: Record<string, string> = {
  any: "Any sector", ai: "AI / ML", agritech: "Agritech", "food-processing": "Food processing", biotech: "Biotech", healthtech: "Healthtech",
  medtech: "Medtech", cleantech: "Cleantech", climate: "Climate", energy: "Energy", "ev-mobility": "EV & mobility", water: "Water",
  waste: "Waste & recycling", defence: "Defence", space: "Space", drones: "Drones", fintech: "Fintech", edtech: "Edtech",
  deeptech: "Deeptech", semiconductors: "Semiconductors", electronics: "Electronics & IoT", "it-software": "IT & software",
  cybersecurity: "Cybersecurity", telecom: "Telecom", manufacturing: "Manufacturing", textiles: "Textiles", handicrafts: "Handicrafts",
  tourism: "Tourism", "media-creative": "Media & creative", logistics: "Logistics", "retail-ecommerce": "Retail & e-commerce",
  "social-impact": "Social impact", rural: "Rural", "smart-cities": "Smart cities", biotechnology: "Biotech",
};

export const STATES: Record<string, string> = {
  "pan-india": "Pan-India", "andhra-pradesh": "Andhra Pradesh", "arunachal-pradesh": "Arunachal Pradesh", assam: "Assam", bihar: "Bihar",
  chhattisgarh: "Chhattisgarh", goa: "Goa", gujarat: "Gujarat", haryana: "Haryana", "himachal-pradesh": "Himachal Pradesh",
  jharkhand: "Jharkhand", karnataka: "Karnataka", kerala: "Kerala", "madhya-pradesh": "Madhya Pradesh", maharashtra: "Maharashtra",
  manipur: "Manipur", meghalaya: "Meghalaya", mizoram: "Mizoram", nagaland: "Nagaland", odisha: "Odisha", punjab: "Punjab",
  rajasthan: "Rajasthan", sikkim: "Sikkim", "tamil-nadu": "Tamil Nadu", telangana: "Telangana", tripura: "Tripura",
  "uttar-pradesh": "Uttar Pradesh", uttarakhand: "Uttarakhand", "west-bengal": "West Bengal", "andaman-nicobar": "Andaman & Nicobar",
  chandigarh: "Chandigarh", "dadra-nagar-haveli-daman-diu": "Dadra & Nagar Haveli, Daman & Diu", delhi: "Delhi",
  "jammu-kashmir": "Jammu & Kashmir", ladakh: "Ladakh", lakshadweep: "Lakshadweep", puducherry: "Puducherry",
};

export const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
export const label = (map: Record<string, string>, key: string) => map[key] ?? titleCase(key);
