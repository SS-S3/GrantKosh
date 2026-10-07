# Contributing to GrantKosh

Thanks for helping founders find funding.

## Adding or fixing a program

1. Edit `data/grants.json`.
2. Use the **official** page (ministry, department, incubator or programme site) as your source and put it in `url`.
3. Write `summary`, `fundingNote` and `eligibility` **in your own words**. Don't paste text from other
   directories or aggregator sites — facts are fine, their write-ups aren't ours to copy.
4. If you checked the details against the official source today, set `verified: true` and
   `lastVerified` to today's date. Otherwise leave `verified: false`.
5. Run `node scripts/validate.mjs` and open a pull request.

## Good first contributions

- Verify an entry marked "Needs check" and update its fields.
- Add your state's startup policy grants.
- Add CSR accelerator programmes that are open to applications.

## Code changes

Keep it dependency-free and static. Open an issue first for anything larger than a small fix.
