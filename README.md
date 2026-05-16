# Portfolio Tracker

Edit the script in Cursor, push to GitHub, and it deploys to Google Apps Script automatically.

## Day-to-day workflow

1. Edit **`src/Code.gs`** in Cursor.
2. Commit and push to GitHub:
   ```bash
   git add src/Code.gs
   git commit -m "Describe your change"
   git push
   ```
3. GitHub deploys to Apps Script (about 1 minute). Check **Actions** on GitHub for a green ✓.
4. Run the script in Google as usual: open your sheet → **Extensions → Apps Script** → select `runDailyPortfolioUpdate` → **Run**.

That’s it. No GCP or OAuth setup required for this workflow.

## One-time setup (do once)

### 1. Enable Apps Script API

[script.google.com/home/usersettings](https://script.google.com/home/usersettings) → turn on **Google Apps Script API**.

### 2. Log in with clasp (on your Mac)

```bash
cd /Users/chris/Desktop/PortfolioTracker-GoogleApp
npm install
npm run login
```

A browser window opens; sign in with the same Google account that owns the spreadsheet.

### 3. Add GitHub secrets

Repo: [github.com/cmcbugg/PortfolioTracker-GoogleApp](https://github.com/cmcbugg/PortfolioTracker-GoogleApp) → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|-------------|--------|
| `APPS_SCRIPT_ID` | Apps Script → **Project settings** → **Script ID** (the long `1Gelf_...` string) |
| `CLASPRC_JSON` | Run `cat ~/.clasprc.json` and paste the **entire** output |

### 4. Push once to test

```bash
git push
```

Open the **Actions** tab on GitHub. If **Deploy to Google Apps Script** is green, your script is live in Google.

## Optional: push from your Mac without GitHub

Only if you want to deploy without committing:

```bash
cp .clasp.json.example .clasp.json
# Edit .clasp.json — set your Script ID
npm run push
```

## Files

| File | Purpose |
|------|---------|
| `src/Code.gs` | Your script (edit this) |
| `src/appsscript.json` | Apps Script settings (rarely changed) |

## Run the script in Google

This repo only **uploads** code. To execute it, use the Apps Script editor or your existing spreadsheet trigger — same as before.
