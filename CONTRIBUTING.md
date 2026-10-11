# Contributing to GrantKosh

Thanks for helping founders find funding.

## Adding or fixing a hand-checked program

1. Edit `data/curated/grants.json`.
2. Use the **official** page (ministry, department, incubator or programme site) as your source and put it in `url`.
3. Write `summary`, `fundingNote` and `eligibility` **in your own words**. Don't paste text from other
   directories or aggregator sites. Facts are fine, but their write-ups aren't ours to copy.
4. If you checked the details against the official source today, set `verified: true` and
   `lastVerified` to today's date. Otherwise leave `verified: false`.
5. Run `npm run validate` and open a pull request.

Curated entries take priority over scraped ones. When a scraper finds the same program, the curated
record wins and only fills its gaps from the scraped one.

## Adding a scraper source

1. Create `scraper/src/sources/<id>.ts` exporting an `OpportunitySource` or `InvestorSource`
   (see `sources/types.ts`). Return `RawOpportunity` / `RawInvestor` objects. Leave out anything the source
   doesn't state, and `normalize.ts` will infer tags from the text.
2. Fetch only through `ctx.http`. It handles robots.txt, rate limits, retries and caching.
3. Keep parsing in pure functions (`parseXxx(html)`), save a real response to `scraper/test/fixtures/`, and
   add tests in `scraper/test/sources.test.ts`.
4. Register the source in `sources/index.ts`. Its position sets its dedupe priority.
5. Run `npm run scrape -- --only <id> --limit 20 --cache` and check the output.

Ground rules: obey robots.txt, identify as GrantKoshBot, keep request rates low, link to the official
source, and never republish another directory's descriptive text.

## Good first contributions

- Verify a scraped entry and add it to the curated file.
- Add a state startup-mission portal as a source.
- Improve the keyword taxonomy in `scraper/src/core/classify.ts` (add a test case with it).
