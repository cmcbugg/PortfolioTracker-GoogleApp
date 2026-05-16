/**
 * Master Portfolio Tracker v36.0
 * Status: DATA-DRIVEN STABILITY
 * Changes: 
 * 1. Uses the "Currency" column from Config to handle GBP/GBX logic.
 * 2. Removed all arbitrary price thresholds.
 * 3. Kept the 3x Retry logic for Google Finance.
 */

const SCRIPT_VERSION = "v36.0";

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
    let currency = row[6] ? row[6].toString().trim().toUpperCase() : "GBP"; // Column G

    if (units === 0 && type.toUpperCase() !== "MANUAL") return;

    let price = 0;
    let source = "";

    if (type.toUpperCase() === "MANUAL") {
      price = units; 
      units = 1;     
      source = "Manual Entry";
    } else {
      // Pass the currency to the price fetcher
      let priceResult = getPriceWithSource(id, type, currency, name);
      price = isNaN(priceResult.price) ? 0 : priceResult.price;
      source = priceResult.source;

      if (price <= 0) {
        let fallbackRow = oldDashboardData.find(r => r[2] === name);
        if (fallbackRow && fallbackRow[3] > 0) {
          price = fallbackRow[3];
          source = "FALLBACK (Last Known)";
          staleFunds.push(name); 
        } else {
          failedFunds.push(`${name} (${id})`);
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
    console.log(`Row ${index + 2}: [${platform}] ${name} | Price: £${price.toFixed(4)} | Value: £${value.toFixed(2)} | Source: ${source}`);
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
  console.log(`--- UPDATE COMPLETE | GRAND TOTAL: £${grandTotal.toFixed(2)} ---`);
}

function getPriceWithSource(id, type, currency, name) {
  let result = { price: 0, source: "None" };
  const upperID = id.toUpperCase().trim();

  try {
    // 1. L&G Portal Bypass (Still needs to be handled because these are always GBX)
    const lgBypassMap = {
      "GB00BJXRFN84": { url: "https://fundcentres.landg.com/en/uk/workplace-adviser/fund-centre/Global-Developed-Equity-Index-Fund/", code: "BC03" },
      "GB00BJXRFM77": { url: "https://fundcentres.landg.com/en/uk/workplace-adviser/fund-centre/World-Emerging-Markets-Equity-Index-Fund/", code: "BD03" }
    };
    if (lgBypassMap[upperID]) {
      const target = lgBypassMap[upperID];
      const html = UrlFetchApp.fetch(target.url, {muteHttpExceptions: true}).getContentText();
      const pattern = new RegExp(target.code + "[\\s\\S]*?([\\d\\.,]+)p", "i");
      const match = html.match(pattern);
      if (match) {
        result.price = parseFloat(match[1].replace(/,/g, '')) / 100;
        result.source = `L&G Portal (${target.code})`;
        return result;
      }
    }

    // 2. SGLN Gold Bypass
    if (upperID === "SGLN") {
      const url = "https://markets.ft.com/data/etfs/tearsheet/summary?s=SGLN:LSE:GBX";
      const html = UrlFetchApp.fetch(url, {muteHttpExceptions: true}).getContentText();
      const match = html.match(/Price \(GBX\)<\/th><td[^>]*>([\d\.,]+)/i) || html.match(/<span class="mod-ui-data-list__value">([\d\.,]+)<\/span>/);
      if (match) { 
        result.price = parseFloat(match[1].replace(/,/g, '')) / 100; 
        result.source = "FT Gold Bypass"; 
        return result; 
      }
    }

    // 3. Google Finance (3x Retry)
    if (type.toUpperCase() === "ETF") {
      const url = `https://www.google.com/finance/quote/${id}:LON`;
      for (let i = 0; i < 3; i++) {
        const html = UrlFetchApp.fetch(url, {muteHttpExceptions: true}).getContentText();
        const match = html.match(/data-last-price="([\d\.]+)"/) || html.match(/class="YMlKec fxKb9e">[^0-9]*([\d\.,]+)/);
        if (match) { 
          let p = parseFloat(match[1].replace(/,/g, '')); 
          // If Config says GBX, divide by 100.
          result.price = (currency === "GBX") ? p / 100 : p;
          result.source = "Google Finance (LON)"; 
          return result; 
        }
        if (i < 2) Utilities.sleep(2000); 
      }
    }

    // 4. FT Fallback
    const variants = [`${id}:GBX`, `${id}:GBP`, id];
    for (let v of variants) {
      const url = `https://markets.ft.com/data/funds/tearsheet/summary?s=${v}`;
      const html = UrlFetchApp.fetch(url, {muteHttpExceptions: true}).getContentText();
      const match = html.match(/<span class="mod-ui-data-list__value">([\d\.,]+)<\/span>/);
      if (match) { 
        let p = parseFloat(match[1].replace(/,/g, '')); 
        // If Config says GBX, divide by 100.
        result.price = (currency === "GBX") ? p / 100 : p;
        result.source = `FT Markets (${v})`; 
        return result; 
      }
    }
  } catch (e) { result.source = "Error: " + e.toString(); }
  return result;
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
    return a.localeCompare(b);
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
  const htmlBody = `<div style="font-family: sans-serif; max-width: 500px; border: 1px solid #ddd; padding: 15px; border-radius: 8px; background-color: #f9f9f9;"><div style="background-color: #fff; padding: 10px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #eee; text-align: center;"><div style="font-size: 1.8em; font-weight: bold; color: #333;">£${total.toLocaleString(undefined, {maximumFractionDigits: 0})}</div><div style="font-size: 1em; color: ${moveGBP >= 0 ? '#008000' : '#d93025'}; font-weight: bold;">${dir}: £${Math.abs(moveGBP).toLocaleString(undefined, {maximumFractionDigits: 0})} (${movePct.toFixed(2)}%)</div></div><table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 5px; font-size: 0.9em;"><thead><tr style="background:#f1f3f4; color:#5f6368; font-size:0.8em;"><th style="padding:5px 8px; text-align:left;">PLATFORM</th><th style="padding:10px; text-align:right;">VALUE</th><th style="padding:10px; text-align:right;">CHANGE</th></tr></thead><tbody>${platformRows}</tbody></table><div style="margin-top: 10px; text-align:center; font-size: 0.85em;"><span style="background:#fff; padding:5px 10px; border-radius:5px; border:1px solid #eee; margin-right:5px;">ISA: <b>£${isa.toLocaleString(undefined, {maximumFractionDigits: 0})}</b></span><span style="background:#fff; padding:5px 10px; border-radius:5px; border:1px solid #eee;">PEN: <b>£${pen.toLocaleString(undefined, {maximumFractionDigits: 0})}</b></span></div>${errorSection}<p style="color: #999; font-size: 0.7em; margin-top: 15px; text-align: center; border-top: 1px solid #eee; padding-top: 10px;">${SCRIPT_VERSION} • Data: FT & Google</p></div>`;
  GmailApp.sendEmail(email, subject, "", { htmlBody: htmlBody, name: "Portfolio Automator" });
}
