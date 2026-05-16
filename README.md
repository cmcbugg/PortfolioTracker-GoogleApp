# Portfolio Tracker

Edit in Cursor → push to GitHub → deploys to Google Apps Script.

## Day-to-day workflow

1. Edit **`src/Code.gs`**
2. `git add src/Code.gs && git commit -m "Your message" && git push`
3. Check **Actions** on GitHub for a green ✓ (~1 min)
4. Run in Google: **Extensions → Apps Script** → `runDailyPortfolioUpdate` → **Run**

## One-time setup

1. [Enable Apps Script API](https://script.google.com/home/usersettings)
2. On your Mac (once, to create GitHub credentials):
   ```bash
   npm install
   npm run login
   cat ~/.clasprc.json   # copy all of this
   ```
3. GitHub repo → **Settings → Secrets → Actions**:
   - `APPS_SCRIPT_ID` — Script ID from Apps Script → Project settings
   - `CLASPRC_JSON` — paste output from step 2
4. `git push` and confirm **Deploy to Google Apps Script** succeeds in Actions

## Do you need `node_modules`?

**No, not for daily use.** `node_modules` is not in git and you can delete it anytime:

```bash
rm -rf node_modules
```

- **GitHub Actions** installs clasp fresh on each deploy (`npm ci` in the cloud).
- You only need `npm install` once on your Mac to run `npm run login` for the `CLASPRC_JSON` secret.
- After secrets are set, you only edit `src/Code.gs` and `git push` — no Node/npm required locally.

## What’s in this repo

| File | Purpose |
|------|---------|
| `src/Code.gs` | Your script |
| `src/appsscript.json` | Timezone / runtime settings |
| `package.json` | Used by GitHub Actions to run clasp (ignore locally) |
| `.github/workflows/deploy.yml` | Auto-deploy on push |
