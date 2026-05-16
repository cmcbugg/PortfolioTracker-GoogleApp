# Portfolio Tracker (Google Apps Script)

Master Portfolio Tracker v36.0 — deployed from this repo to Google Apps Script via [clasp](https://github.com/google/clasp) and GitHub Actions.

## Repository layout

| Path | Purpose |
|------|---------|
| `src/Code.gs` | Main script (source of truth) |
| `appsscript.json` | Apps Script manifest |
| `.clasp.json` | Links this repo to your script (local only, not committed) |
| `scripts/run-function.js` | Run a function remotely and show logs |

## One-time setup

### 1. Enable the Apps Script API

Open [script.google.com/home/usersettings](https://script.google.com/home/usersettings) and turn on **Google Apps Script API**.

### 2. Link to your existing script

In the Google Sheet: **Extensions → Apps Script**. Copy the **Script ID** from **Project settings** (starts with something like `1abc...`).

```bash
cd /path/to/PortfolioTracker-GoogleApp
npm install
cp .clasp.json.example .clasp.json
# Edit .clasp.json and paste your script ID
npm run login    # opens browser for Google OAuth
npm run push     # upload src/Code.gs to Apps Script
```

### 3. GitHub secrets (for CI deploy & remote runs)

In the GitHub repo: **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|--------|
| `APPS_SCRIPT_ID` | Your Apps Script project ID |
| `CLASPRC_JSON` | Full contents of `~/.clasprc.json` after `npm run login` |

To copy your clasp credentials:

```bash
cat ~/.clasprc.json
```

Paste the entire JSON into the `CLASPRC_JSON` secret.

After secrets are set, every push to `main` runs **Deploy to Google Apps Script**. Use **Actions → Run Apps Script function** to execute tests in the cloud.

## Local development

```bash
npm install
npm run push          # deploy local changes
npm run run:test      # run testGetPriceSample (safe, no email)
npm run run:dry       # dryRunPortfolioUpdate (reads Config, no writes/email)
npm run logs          # tail Stackdriver logs
npm run open          # open script in browser
```

### Test functions

- **`testGetPriceSample`** — Fetches a sample price (SGLN). No spreadsheet changes.
- **`dryRunPortfolioUpdate`** — Reads your Config sheet, fetches all prices, logs totals. No dashboard/history updates, no email.
- **`runDailyPortfolioUpdate`** — Full production run (writes sheets, sends email). Use only when intended.

## CI workflows

- **Deploy to Google Apps Script** — Runs on push to `main`; runs `clasp push`.
- **Run Apps Script function** — Manual workflow; choose function and view logs in the Actions run.

## Migrating from `portfolio-tracker.v36.0`

The original export file is kept for reference. **`src/Code.gs`** is what gets deployed.
