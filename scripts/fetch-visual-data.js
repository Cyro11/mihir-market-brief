import path from "node:path";
import { marketDataDir } from "./config.js";
import { editionDate, ensureDir, writeJson } from "./utils.js";

const fredSeries = [
  {
    id: "DGS10",
    label: "10-Year Treasury Yield",
    source: "FRED / U.S. Treasury",
    url: "https://fred.stlouisfed.org/series/DGS10"
  },
  {
    id: "DGS2",
    label: "2-Year Treasury Yield",
    source: "FRED / U.S. Treasury",
    url: "https://fred.stlouisfed.org/series/DGS2"
  },
  {
    id: "FEDFUNDS",
    label: "Effective Federal Funds Rate",
    source: "FRED / Federal Reserve",
    url: "https://fred.stlouisfed.org/series/FEDFUNDS"
  },
  {
    id: "BAMLH0A0HYM2",
    label: "High Yield Option-Adjusted Spread",
    source: "FRED / ICE BofA",
    url: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2"
  },
  {
    id: "DCOILWTICO",
    label: "WTI Crude Oil Spot Price",
    source: "FRED / U.S. EIA",
    url: "https://fred.stlouisfed.org/series/DCOILWTICO"
  }
];

const marketSeries = [
  {
    id: "DELL",
    label: "Dell Technologies",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/DELL?range=3mo&interval=1d",
    yahooSymbol: "DELL",
    stooqSymbol: "dell.us"
  },
  {
    id: "NVDA",
    label: "Nvidia",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=3mo&interval=1d",
    yahooSymbol: "NVDA",
    stooqSymbol: "nvda.us"
  },
  {
    id: "MKC",
    label: "McCormick",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/MKC?range=3mo&interval=1d",
    yahooSymbol: "MKC",
    stooqSymbol: "mkc.us"
  },
  {
    id: "SPY",
    label: "SPDR S&P 500 ETF Trust",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=3mo&interval=1d",
    yahooSymbol: "SPY",
    stooqSymbol: "spy.us"
  },
  {
    id: "QQQ",
    label: "Invesco QQQ Trust",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/QQQ?range=3mo&interval=1d",
    yahooSymbol: "QQQ",
    stooqSymbol: "qqq.us"
  },
  {
    id: "IWM",
    label: "iShares Russell 2000 ETF",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/IWM?range=3mo&interval=1d",
    yahooSymbol: "IWM",
    stooqSymbol: "iwm.us"
  },
  {
    id: "GLD",
    label: "SPDR Gold Shares",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/GLD?range=3mo&interval=1d",
    yahooSymbol: "GLD",
    stooqSymbol: "gld.us"
  },
  {
    id: "USO",
    label: "United States Oil Fund",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/USO?range=3mo&interval=1d",
    yahooSymbol: "USO",
    stooqSymbol: "uso.us"
  },
  {
    id: "BX",
    label: "Blackstone",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/BX?range=3mo&interval=1d",
    yahooSymbol: "BX",
    stooqSymbol: "bx.us"
  },
  {
    id: "KKR",
    label: "KKR",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/KKR?range=3mo&interval=1d",
    yahooSymbol: "KKR",
    stooqSymbol: "kkr.us"
  },
  {
    id: "APO",
    label: "Apollo Global Management",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/APO?range=3mo&interval=1d",
    yahooSymbol: "APO",
    stooqSymbol: "apo.us"
  },
  {
    id: "OWL",
    label: "Blue Owl Capital",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/OWL?range=3mo&interval=1d",
    yahooSymbol: "OWL",
    stooqSymbol: "owl.us"
  },
  {
    id: "ARCC",
    label: "Ares Capital",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/ARCC?range=3mo&interval=1d",
    yahooSymbol: "ARCC",
    stooqSymbol: "arcc.us"
  },
  {
    id: "BXSL",
    label: "Blackstone Secured Lending Fund",
    source: "Yahoo Finance public chart data",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/BXSL?range=3mo&interval=1d",
    yahooSymbol: "BXSL",
    stooqSymbol: "bxsl.us"
  }
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseFredCsv(csv, limit = 90) {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, value] = line.split(",");
      const number = Number(value);
      return Number.isFinite(number) ? { date, value: number } : null;
    })
    .filter(Boolean)
    .slice(-limit);
}

function parseStooqCsv(csv, limit = 90) {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, , , , close] = line.split(",");
      const number = Number(close);
      return Number.isFinite(number) ? { date, value: number } : null;
    })
    .filter(Boolean)
    .slice(-limit);
}

function parseYahooChart(json, limit = 90) {
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return timestamps
    .map((timestamp, index) => {
      const value = Number(closes[index]);
      if (!Number.isFinite(value)) return null;
      return { date: new Date(timestamp * 1000).toISOString().slice(0, 10), value };
    })
    .filter(Boolean)
    .slice(-limit);
}

async function fetchFred(series) {
  const response = await fetchWithTimeout(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series.id}`, {
    headers: { "user-agent": "TheOpeningLedger/0.1 public educational market brief" }
  });
  if (!response.ok) throw new Error(`${series.id} returned ${response.status}`);
  const observations = parseFredCsv(await response.text()).filter((point) => (
    series.id === "DCOILWTICO" ? point.value > 0 : true
  ));
  if (!observations.length) throw new Error(`${series.id} returned no observations`);
  return {
    ...series,
    fetchedAt: new Date().toISOString(),
    observations
  };
}

async function fetchMarketSeries(series) {
  const yahooResponse = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${series.yahooSymbol}?range=3mo&interval=1d`, {
    headers: { "user-agent": "TheOpeningLedger/0.1 public educational market brief" }
  });
  if (yahooResponse.ok) {
    const observations = parseYahooChart(await yahooResponse.json());
    if (observations.length) {
      return {
        ...series,
        fetchedAt: new Date().toISOString(),
        observations
      };
    }
  }

  const response = await fetchWithTimeout(`https://stooq.com/q/d/l/?s=${series.stooqSymbol}&i=d`, {
    headers: { "user-agent": "TheOpeningLedger/0.1 public educational market brief" }
  });
  if (!response.ok) throw new Error(`${series.id} returned ${response.status}`);
  const observations = parseStooqCsv(await response.text());
  if (!observations.length) throw new Error(`${series.id} returned no observations`);
  return {
    ...series,
    source: "Stooq public market data",
    url: `https://stooq.com/q/d/l/?s=${series.stooqSymbol}&i=d`,
    fetchedAt: new Date().toISOString(),
    observations
  };
}

async function main() {
  const runDate = process.env.BRIEF_DATE || editionDate();
  const cutoffDate = (process.env.BRIEF_NOW || `${runDate}T23:59:59-04:00`).slice(0, 10);
  await ensureDir(marketDataDir);
  const series = [];
  const failures = [];
  for (const item of fredSeries) {
    try {
      series.push(await fetchFred(item));
    } catch (error) {
      failures.push({ id: item.id, message: error.message });
    }
  }
  for (const item of marketSeries) {
    try {
      series.push(await fetchMarketSeries(item));
    } catch (error) {
      failures.push({ id: item.id, message: error.message });
    }
  }

  const payload = {
    runDate,
    fetchedAt: new Date().toISOString(),
    sourceNote: "Numeric market visuals use public FRED CSV downloads and preserve source links.",
    marketSourceNote: "Stock visuals use public Yahoo Finance chart data with Stooq fallback as market-data context, not live trading data.",
    series: series.map((item) => ({
      ...item,
      observations: (item.observations || []).filter((point) => point.date <= cutoffDate)
    })).filter((item) => item.observations.length),
    failures
  };
  await writeJson(path.join(marketDataDir, `${runDate}.json`), payload);
  await writeJson(path.join(marketDataDir, "latest.json"), payload);
  console.log(`Fetched ${series.length} visual-data series for ${runDate}; failures: ${failures.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
