/**
 * Master Portfolio Tracker
 * Price lookup: L&G bypass (mapped ISINs) then FT funds tearsheet (iOS parity).
 * Currency: parsed from FT HTML; USD/EUR/etc. via Frankfurter; Config column G is fallback only.
 */

const SCRIPT_VERSION = "v36.3";
const FX_CACHE_KEY = "CachedForeignToGbpFactorsJSON";
const FT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const LG_BYPASS_MAP = {
  "GB00BJXRFN84": { url: "https://fundcentres.landg.com/en/uk/workplace-adviser/fund-centre/Global-Developed-Equity-Index-Fund/", code: "BC03" },
  "GB00BJXRFM77": { url: "https://fundcentres.landg.com/en/uk/workplace-adviser/fund-centre/World-Emerging-Markets-Equity-Index-Fund/", code: "BD03" }
};

function runDailyPortfolioUpdate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName("Config");
  const dashboard = ss.getSheetByName("Daily Dashboard") || ss.insertSheet("Daily Dashboard");
  const history = ss.getSheetByName("History") || ss.insertSheet("History");
  const growthSheet = ss.getSheetByName("Monthly Growth") || ss.insertSheet("Monthly Growth");
  
  const myEmail = "cmcoombs@gmail.com"; 
  const lastRowConfig = configSheet.getLastRow();
  if (lastRowConfig < 2) return;
  
  const oldDashboardData = dashboard.getDataRange().getValues();
  // Fetching 7 columns now to include Currency
  const data = configSheet.getRange(2, 1, lastRowConfig - 1, 7).getValues();

  dashboard.clear();
  dashboard.getRange("A1:E1").setValues([["Platform", "Account", "Fund Name", "Latest Price", "Value (£)"]])
    .setFontWeight("bold").setBackground("#f3f3f3");

  let totalsByPlatform = {};
  let platformToAccountMap = {}; 
  let isaTotal = 0, penTotal = 0;
  let failedFunds = [];
  let staleFunds = []; 

  console.log(`--- STARTING PORTFOLIO UPDATE (${SCRIPT_VERSION}) ---`);

  data.forEach((row, index) => {
    let platform = row[0] ? row[0].toString().trim() : "Unknown";
    let account = row[1] ? row[1].toString().trim() : "Unknown";
    let name = row[2] ? row[2].toString() : "Unknown";
    let id = row[3] ? row[3].toString().trim() : "";
    let type = row[4] ? row[4].toString().trim() : "";
    let units = parseFloat(row[5]) || 0;
    let currency = row[6] ? row[6].toString().trim().toUpperCase() : "GBP"; // Column G (fallback if FT omits currency)

    if (units === 0 && type.toUpperCase() !== "MANUAL") return;

    let price = 0;
    let source = "";

    let logStatus = "OK";
    let lookupFailureReason = "";

    if (type.toUpperCase() === "MANUAL") {
      price = units;
      units = 1;
      source = "Manual Entry";
    } else {
      let priceResult = getPriceWithSource(id, type, currency, name);
      price = isNaN(priceResult.price) ? 0 : priceResult.price;
      source = priceResult.source;

      if (price <= 0) {
        lookupFailureReason = source || "Unknown lookup error";
        let fallbackRow = oldDashboardData.find(r => r[2] === name);
        if (fallbackRow && fallbackRow[3] > 0) {
          price = fallbackRow[3];
          source = "FALLBACK (Last Known)";
          staleFunds.push(name);
          logStatus = "STALE";
        } else {
          failedFunds.push(`${name} (${id})`);
          logStatus = "FAIL";
        }
      }
    }

    let value = price * units;
    if (!totalsByPlatform[platform]) totalsByPlatform[platform] = 0;
    totalsByPlatform[platform] += value;

    if (account.toUpperCase().includes("ISA")) {
      isaTotal += value;
      platformToAccountMap[platform] = "ISA";
    } else {
      penTotal += value;
      platformToAccountMap[platform] = "PEN";
    }

    dashboard.appendRow([platform, account, name, price, value]);
    logFundPriceRow(index + 2, platform, name, id, price, value, source, logStatus, lookupFailureReason);
    Utilities.sleep(500); 
  });

  let grandTotal = isaTotal + penTotal;
  updateOrderedSheet(history, platformToAccountMap, totalsByPlatform, isaTotal, penTotal, grandTotal, "Date");
  updateOrderedSheet(growthSheet, platformToAccountMap, totalsByPlatform, isaTotal, penTotal, grandTotal, "Month");

  // Deltas and Emailing logic
  let headers = history.getRange(1, 1, 1, history.getLastColumn()).getValues()[0];
  let lastRowHist = history.getLastRow();
  let grandTotalCol = headers.indexOf("Grand Total") + 1;
  let prevTotal = lastRowHist > 1 ? history.getRange(lastRowHist - 1, grandTotalCol).getValue() : grandTotal;
  let moveGBP = grandTotal - (parseFloat(prevTotal) || grandTotal);

  let platformDeltas = {};
  if (history.getLastRow() > 2) {
    let lastRecord = history.getRange(history.getLastRow(), 1, 1, history.getLastColumn()).getValues()[0];
    let prevRecord = history.getRange(history.getLastRow() - 1, 1, 1, history.getLastColumn()).getValues()[0];
    Object.keys(totalsByPlatform).forEach(plat => {
      let colIdx = headers.indexOf(plat);
      if (colIdx > -1) {
        platformDeltas[plat] = {
          amount: lastRecord[colIdx] - prevRecord[colIdx],
          percent: prevRecord[colIdx] > 0 ? ((lastRecord[colIdx] - prevRecord[colIdx]) / prevRecord[colIdx]) * 100 : 0
        };
      }
    });
  }

  sendPlatformEmail(myEmail, totalsByPlatform, platformToAccountMap, isaTotal, penTotal, grandTotal, moveGBP, failedFunds, staleFunds, platformDeltas, false);
  logPriceLookupSummary(failedFunds, staleFunds);
  console.log(`--- UPDATE COMPLETE | GRAND TOTAL: £${grandTotal.toFixed(2)} ---`);
}

function logFundPriceRow(rowNum, platform, name, id, price, value, source, logStatus, lookupFailureReason) {
  const base = `Row ${rowNum}: [${platform}] ${name} (${id})`;
  if (logStatus === "FAIL") {
    console.warn(`[FAIL] ${base} | LOOKUP FAILED: ${lookupFailureReason} | NO FALLBACK | Value: £0.00`);
    return;
  }
  if (logStatus === "STALE") {
    console.warn(
      `[STALE] ${base} | LOOKUP FAILED: ${lookupFailureReason} | Using last known £${price.toFixed(4)} | Value: £${value.toFixed(2)} | Source: ${source}`
    );
    return;
  }
  console.log(`[OK] ${base} | Price: £${price.toFixed(4)} | Value: £${value.toFixed(2)} | Source: ${source}`);
}

function logPriceLookupSummary(failedFunds, staleFunds) {
  console.log("--- PRICE LOOKUP SUMMARY ---");
  if (staleFunds.length === 0 && failedFunds.length === 0) {
    console.log("[OK] All funds priced from live lookup or manual entry.");
  }
  if (staleFunds.length > 0) {
    console.warn(`[STALE] ${staleFunds.length} fund(s) used last known price: ${staleFunds.join(", ")}`);
  }
  if (failedFunds.length > 0) {
    console.warn(`[FAIL] ${failedFunds.length} fund(s) could not be priced: ${failedFunds.join(", ")}`);
  }
}

function getPriceWithSource(id, type, currency, name) {
  try {
    return scrapeLGBypassOrFT(id, currency);
  } catch (e) {
    return { price: 0, source: "Error: " + e.toString() };
  }
}

/** L&G mapped ISINs first; if bypass fails, fall through to FT (iOS parity). */
function scrapeLGBypassOrFT(ticker, configCurrencyFallback) {
  const key = ticker.toUpperCase().trim();
  if (LG_BYPASS_MAP[key]) {
    const lg = scrapeLGFundCentre(LG_BYPASS_MAP[key]);
    if (lg.price > 0) return lg;
  }
  return scrapeFT(ticker, configCurrencyFallback);
}

function scrapeLGFundCentre(target) {
  const fetch = fetchHtml(target.url);
  if (!fetch.ok) return { price: 0, source: "L&G Portal (" + fetch.error + ")" };
  const pattern = new RegExp(target.code + "[\\s\\S]*?([\\d\\.,]+)p", "i");
  const match = fetch.text.match(pattern);
  if (!match) return { price: 0, source: "L&G Portal (parse failed)" };
  const pence = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(pence) || pence <= 0) return { price: 0, source: "L&G Portal (invalid price)" };
  return { price: pence / 100, source: "L&G Fund Centre (" + target.code + ")" };
}

function scrapeFT(ticker, configCurrencyFallback) {
  const url = fundsTearsheetURL(ticker);
  if (!url) return { price: 0, source: "FT Markets (invalid ticker)" };
  const fetch = fetchHtml(url);
  if (!fetch.ok) return { price: 0, source: "FT Markets (" + fetch.error + ")" };
  const parsed = extractFTPricePayload(fetch.text);
  if (!parsed) return { price: 0, source: "FT Markets (parse failed)" };
  const quoteCurrency = parsed.currency || configCurrencyFallback || "GBP";
  const gbp = normalizeToGbp(parsed.rawPrice, quoteCurrency);
  if (gbp <= 0 || isNaN(gbp)) {
    const err = (quoteCurrency !== "GBP" && quoteCurrency !== "GBX")
      ? quoteCurrency + "→GBP rate unavailable"
      : "normalize failed";
    return { price: 0, source: "FT Markets (" + err + ")" };
  }
  let source = "FT Markets";
  if (quoteCurrency === "GBX") source += " (from " + parsed.displayAmount + " GBX)";
  else if (quoteCurrency !== "GBP") source += " (from " + parsed.displayAmount + " " + quoteCurrency + ")";
  return { price: gbp, source: source };
}

function fundsTearsheetURL(ticker) {
  const t = ticker.trim();
  if (!t) return null;
  return "https://markets.ft.com/data/funds/tearsheet/summary?s=" + encodeURIComponent(t);
}

function fetchHtml(url) {
  const resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { "User-Agent": FT_USER_AGENT }
  });
  const code = resp.getResponseCode();
  if (code < 200 || code > 299) return { ok: false, error: "HTTP " + code };
  const text = resp.getContentText();
  if (text.indexOf("No results found") >= 0) return { ok: false, error: "Ticker not found" };
  if (htmlLooksProbablyBlocked(text)) return { ok: false, error: "Response blocked" };
  if (text.length < 2000) return { ok: false, error: "Short response (" + text.length + " chars)" };
  return { ok: true, text: text };
}

function htmlLooksProbablyBlocked(html) {
  const lc = html.toLowerCase();
  const markers = [
    "attention required", "access denied", "forbidden", "requested url was rejected",
    "error 403", "error 429", "captcha", "verify you are human", "are you human"
  ];
  return markers.some(function(m) { return lc.indexOf(m) >= 0; });
}

/** Matches iOS extractFTPricePayload. */
function extractFTPricePayload(html) {
  const priceMatch = html.match(/<span class="mod-ui-data-list__value">([\d\.,]+)<\/span>/);
  if (!priceMatch) return null;
  const currMatch = html.match(/Price\s*\(([A-Za-z]{3})\)/i);
  const currency = currMatch ? currMatch[1].toUpperCase() : "GBP";
  const rawPrice = parseFloat(priceMatch[1].replace(/,/g, ""));
  if (isNaN(rawPrice) || rawPrice <= 0) return null;
  return { rawPrice: rawPrice, currency: currency, displayAmount: priceMatch[1] };
}

/** GBP per unit: GBP as-is, GBX÷100, foreign × Frankfurter factor (iOS parity). */
function normalizeToGbp(rawPrice, quoteCurrency) {
  const c = (quoteCurrency || "GBP").toUpperCase();
  if (c === "GBP") return rawPrice;
  if (c === "GBX") return rawPrice / 100;
  const factor = getForeignToGbpFactor(c);
  if (!factor || factor <= 0 || !isFinite(factor)) return 0;
  return rawPrice * factor;
}

function loadFxCache() {
  const json = PropertiesService.getScriptProperties().getProperty(FX_CACHE_KEY);
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveFxCache(cache) {
  PropertiesService.getScriptProperties().setProperty(FX_CACHE_KEY, JSON.stringify(cache));
}

/** Frankfurter: rate = foreign units per 1 GBP → factor = 1/rate → gbp = raw × factor */
function getForeignToGbpFactor(isoCode) {
  const c = isoCode.toUpperCase();
  if (c === "GBP" || c === "GBX") return 1;
  const cache = loadFxCache();
  if (cache[c] && cache[c] > 0 && isFinite(cache[c])) return cache[c];
  try {
    const url = "https://api.frankfurter.dev/v1/latest?base=GBP&symbols=" + encodeURIComponent(c);
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() < 200 || resp.getResponseCode() > 299) return cache[c] || null;
    const json = JSON.parse(resp.getContentText());
    const rates = json.rates || {};
    const rate = rates[c] || rates[Object.keys(rates).find(function(k) { return k.toUpperCase() === c; })];
    if (!rate || rate <= 0 || !isFinite(rate)) return cache[c] || null;
    cache[c] = 1.0 / rate;
    saveFxCache(cache);
    return cache[c];
  } catch (e) {
    return cache[c] || null;
  }
}

// Support functions (updateOrderedSheet and sendPlatformEmail) same as before.
function updateOrderedSheet(sheet, platformToAccountMap, platformValues, isa, pen, total, firstColName) {
  let isMonthly = (firstColName === "Month");
  let sortedPlatforms = Object.keys(platformValues).sort((a, b) => {
    let catA = platformToAccountMap[a] || "PEN";
    let catB = platformToAccountMap[b] || "PEN";
    if (catA === "ISA" && catB !== "ISA") return -1;
    if (catA !== "ISA" && catB === "ISA") return 1;
    return a.localeCompare(b);
  });
  let headers = [firstColName, ...sortedPlatforms, "ISA Total", "Pension Total", "Grand Total", "% Change"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  const dateStr = isMonthly ? Utilities.formatDate(new Date(), "GMT", "MMM yyyy") : new Date();
  let rowIndex = 0;
  if (isMonthly && sheet.getLastRow() > 1) {
    let labels = sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues().flat();
    rowIndex = labels.indexOf(dateStr) + 1;
  }
  let lastRow = sheet.getLastRow();
  let grandTotalIdx = headers.indexOf("Grand Total");
  let prevTotal = (isMonthly && rowIndex > 2) ? sheet.getRange(rowIndex - 1, grandTotalIdx + 1).getValue() : (lastRow > 1) ? sheet.getRange(lastRow, grandTotalIdx + 1).getValue() : 0;
  let movePct = prevTotal > 0 ? (total - prevTotal) / prevTotal : 0;
  let newRow = headers.map(h => {
    if (h === firstColName) return dateStr;
    if (platformValues[h] !== undefined) return platformValues[h];
    if (h === "ISA Total") return isa;
    if (h === "Pension Total") return pen;
    if (h === "Grand Total") return total;
    if (h === "% Change") return movePct;
    return 0;
  });
  if (rowIndex > 1) sheet.getRange(rowIndex, 1, 1, headers.length).setValues([newRow]);
  else sheet.appendRow(newRow);
  let finalRow = sheet.getLastRow();
  sheet.getRange(finalRow, 2, 1, headers.indexOf("Grand Total")).setNumberFormat("£#,##0");
  let pctRange = sheet.getRange(finalRow, headers.length);
  pctRange.setNumberFormat("0.00%");
  if (movePct > 0) pctRange.setBackground("#d9ead3").setFontColor("#38761d");
  else if (movePct < 0) pctRange.setBackground("#f4cccc").setFontColor("#990000");
}

function sendPlatformEmail(email, platformMap, typeMap, isa, pen, total, moveGBP, failed, stale, deltas, isMonthly) {
  const dir = moveGBP >= 0 ? "UP" : "DOWN";
  const prevTot = total - moveGBP;
  const movePct = prevTot > 0 ? (moveGBP / prevTot) * 100 : 0;
  const prefix = isMonthly ? "MONTHLY REPORT" : "Portfolio";
  const subject = `${prefix}: £${total.toLocaleString(undefined, {maximumFractionDigits: 0})} [${dir}]`;
  let keys = Object.keys(platformMap).sort((a, b) => {
    let catA = typeMap[a] || "PEN";
    let catB = typeMap[b] || "PEN";
    if (catA === "ISA" && catB !== "ISA") return -1;
    if (catA !== "ISA" && catB === "ISA") return 1;
    return platformMap[b] - platformMap[a];
  });
  let platformRows = "";
  keys.forEach(plat => {
    let delta = deltas[plat] || { amount: 0, percent: 0 };
    let color = delta.amount > 0 ? "#008000" : (delta.amount < 0 ? "#d93025" : "#888");
    let sign = delta.amount > 0 ? "+" : "";
    let isStale = stale.some(sName => sName.toLowerCase().includes(plat.toLowerCase())); 
    let rowBg = isStale ? "#fff4e5" : "#ffffff";
    platformRows += `<tr style="background-color: ${rowBg}; border-bottom: 1px solid #eee;"><td style="padding:5px 8px; font-weight:bold; color:#333;">${plat}</td><td style="padding:5px 8px; text-align:right; font-weight:bold;">£${platformMap[plat].toLocaleString(undefined, {maximumFractionDigits: 0})}</td><td style="padding:5px 8px; text-align:right; color:${color}; font-size:0.85em;">${sign}£${Math.abs(delta.amount).toLocaleString(undefined, {maximumFractionDigits: 0})} (${sign}${delta.percent.toFixed(1)}%)</td></tr>`;
  });
  let errorSection = "";
  if (failed.length > 0) errorSection += `<div style="background:#fce8e6; padding:8px; border-radius:5px; margin-top:10px; color:#d93025; font-size:0.85em;"><b>Flagged Zeros:</b> ${failed.join(", ")}</div>`;
  if (stale.length > 0) errorSection += `<div style="background:#fff4e5; padding:8px; border-radius:5px; margin-top:5px; color:#664d03; border: 1px solid #ffecb5; font-size:0.85em;"><b>Stale Prices:</b> ${stale.join(", ")}</div>`;
  const htmlBody = `<div style="font-family: sans-serif; max-width: 500px; border: 1px solid #ddd; padding: 15px; border-radius: 8px; background-color: #f9f9f9;"><div style="background-color: #fff; padding: 10px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #eee; text-align: center;"><div style="font-size: 1.8em; font-weight: bold; color: #333;">£${total.toLocaleString(undefined, {maximumFractionDigits: 0})}</div><div style="font-size: 1em; color: ${moveGBP >= 0 ? '#008000' : '#d93025'}; font-weight: bold;">${dir}: £${Math.abs(moveGBP).toLocaleString(undefined, {maximumFractionDigits: 0})} (${movePct.toFixed(2)}%)</div></div><table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 5px; font-size: 0.9em;"><thead><tr style="background:#f1f3f4; color:#5f6368; font-size:0.8em;"><th style="padding:5px 8px; text-align:left;">PLATFORM</th><th style="padding:10px; text-align:right;">VALUE</th><th style="padding:10px; text-align:right;">CHANGE</th></tr></thead><tbody>${platformRows}</tbody></table><div style="margin-top: 10px; text-align:center; font-size: 0.85em;"><span style="background:#fff; padding:5px 10px; border-radius:5px; border:1px solid #eee; margin-right:5px;">ISA: <b>£${isa.toLocaleString(undefined, {maximumFractionDigits: 0})}</b></span><span style="background:#fff; padding:5px 10px; border-radius:5px; border:1px solid #eee;">PEN: <b>£${pen.toLocaleString(undefined, {maximumFractionDigits: 0})}</b></span></div>${errorSection}<p style="color: #999; font-size: 0.7em; margin-top: 15px; text-align: center; border-top: 1px solid #eee; padding-top: 10px;">${SCRIPT_VERSION} • Data: FT</p></div>`;
  GmailApp.sendEmail(email, subject, "", { htmlBody: htmlBody, name: "Portfolio Automator" });
}
