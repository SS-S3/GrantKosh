import { readFileSync } from "node:fs";

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
export const TODAY = "2026-10-08";
