(() => {
  const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
  const CORS_READER_BASE = "https://r.jina.ai/http://r.jina.ai/http://";
  const REFRESH_MS = 5 * 60 * 1000;
  const SYMBOLS = {
    SPY: { yahoo: "SPY", label: "S&P 500 ETF", prefix: "$", decimals: 2 },
    QQQ: { yahoo: "QQQ", label: "Nasdaq 100 ETF", prefix: "$", decimals: 2 },
    IWM: { yahoo: "IWM", label: "Russell 2000 ETF", prefix: "$", decimals: 2 },
    GLD: { yahoo: "GLD", label: "Gold ETF", prefix: "$", decimals: 2 },
    USO: { yahoo: "USO", label: "Oil proxy (USO ETF)", prefix: "$", decimals: 2, note: "Timely oil proxy replacing stale FRED WTI on page open." }
  };

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function formatNumber(value, decimals = 2) {
    if (!Number.isFinite(value)) return "—";
    return value.toFixed(decimals);
  }

  function formatPrice(quote) {
    return `${quote.prefix || ""}${formatNumber(quote.price, quote.decimals)}`;
  }

  function formatChange(quote) {
    if (!Number.isFinite(quote.change) || !Number.isFinite(quote.percentChange)) return "—";
    const sign = quote.change >= 0 ? "+" : "";
    const percentSign = quote.percentChange >= 0 ? "+" : "";
    return `${sign}${formatNumber(quote.change, 2)} / ${percentSign}${formatNumber(quote.percentChange, 2)}%`;
  }

  function yahooUrl(symbol) {
    const params = new URLSearchParams({ range: "1d", interval: "1m", includePrePost: "true" });
    return `${YAHOO_BASE}${encodeURIComponent(symbol)}?${params}`;
  }

  function corsReaderUrl(url) {
    return `${CORS_READER_BASE}${url}`;
  }

  function extractReaderJson(text) {
    const marker = "Markdown Content:";
    const markerIndex = text.indexOf(marker);
    const raw = markerIndex >= 0 ? text.slice(markerIndex + marker.length).trim() : text.trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("CORS reader did not return chart JSON");
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  }

  function attrEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function latestFinite(values) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (Number.isFinite(value)) return { value, index };
    }
    return null;
  }

  function previousFinite(values, beforeIndex) {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  async function fetchChartPayload(url) {
    try {
      const response = await fetch(url, { cache: "no-store", mode: "cors" });
      if (!response.ok) throw new Error(`Yahoo chart returned HTTP ${response.status}`);
      return {
        payload: await response.json(),
        source: "Yahoo Finance delayed intraday chart",
        sourceUrl: url
      };
    } catch (directError) {
      const fallback = corsReaderUrl(url);
      const response = await fetch(fallback, { cache: "no-store" });
      if (!response.ok) throw new Error(`Yahoo chart unavailable and CORS reader returned HTTP ${response.status}: ${directError.message}`);
      return {
        payload: extractReaderJson(await response.text()),
        source: "Yahoo Finance delayed intraday chart via CORS reader",
        sourceUrl: url
      };
    }
  }

  async function fetchYahooQuote(symbolKey) {
    const config = SYMBOLS[symbolKey];
    if (!config) throw new Error(`No live quote mapping for ${symbolKey}`);
    const chartUrl = yahooUrl(config.yahoo);
    const { payload, source, sourceUrl } = await fetchChartPayload(chartUrl);
    const result = payload?.chart?.result?.[0];
    const error = payload?.chart?.error;
    if (error) throw new Error(error.description || error.code || "Yahoo chart error");
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const timestamps = result?.timestamp || [];
    const latest = latestFinite(closes);
    if (!latest) throw new Error("Yahoo chart returned no intraday close");
    const previousClose = Number(result?.meta?.chartPreviousClose);
    const prior = Number.isFinite(previousClose) ? previousClose : previousFinite(closes, latest.index);
    const price = latest.value;
    const change = Number.isFinite(prior) ? price - prior : NaN;
    const percentChange = Number.isFinite(prior) && prior !== 0 ? (change / prior) * 100 : NaN;
    const timestampSeconds = timestamps[latest.index] || result?.meta?.regularMarketTime;
    const asOf = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();
    return {
      symbolKey,
      displaySymbol: symbolKey,
      label: config.label,
      price,
      change,
      percentChange,
      asOf,
      source,
      sourceUrl,
      prefix: config.prefix,
      decimals: config.decimals,
      note: config.note || "Delayed intraday quote refreshed when this page was opened."
    };
  }

  function setStatus(root, text, kind = "") {
    const status = $("[data-market-watch-status]", root);
    if (!status) return;
    status.textContent = text;
    status.dataset.statusKind = kind;
  }

  function updateQuoteNodes(quote) {
    const nodes = $all(`[data-market-symbol="${attrEscape(quote.symbolKey)}"]`);
    for (const node of nodes) {
      const price = $("[data-market-price]", node);
      const change = $("[data-market-change]", node);
      const stamp = $("[data-market-timestamp]", node);
      const source = $("[data-market-source]", node);
      const label = $("[data-market-label]", node);
      if (price) price.textContent = formatPrice(quote);
      if (change) {
        change.textContent = node.matches(".watch-quote")
          ? `${quote.percentChange >= 0 ? "+" : ""}${formatNumber(quote.percentChange, 2)}%`
          : formatChange(quote);
        change.classList.toggle("up", quote.change >= 0);
        change.classList.toggle("down", quote.change < 0);
      }
      if (stamp) stamp.textContent = `Live-ish delayed quote as of ${quote.asOf.toLocaleString()}`;
      if (source) {
        source.textContent = quote.source;
        if (source.tagName === "A") source.href = quote.sourceUrl;
      }
      if (label) label.textContent = quote.label;
      node.dataset.marketLive = "ok";
      node.dataset.marketAsOf = quote.asOf.toISOString();
    }
  }

  function markQuoteFailure(symbolKey, error) {
    const nodes = $all(`[data-market-symbol="${attrEscape(symbolKey)}"]`);
    for (const node of nodes) {
      const stamp = $("[data-market-timestamp]", node);
      if (stamp) stamp.textContent = `Live quote unavailable; showing stale rendered value. ${error.message}`;
      node.dataset.marketLive = "failed";
    }
  }

  async function refreshMarketWatch() {
    const root = $("[data-market-watch]");
    if (!root || root.dataset.marketWatchLive === "off") return;
    const symbols = [...new Set($all("[data-market-symbol]", root).map((node) => node.dataset.marketSymbol).filter(Boolean))];
    if (!symbols.length) return;
    setStatus(root, "Refreshing delayed intraday quotes on page open…", "loading");
    const results = await Promise.allSettled(symbols.map((symbol) => fetchYahooQuote(symbol)));
    let ok = 0;
    const failures = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        ok += 1;
        updateQuoteNodes(result.value);
      } else {
        failures.push(result.reason);
      }
    }
    for (let index = 0; index < results.length; index += 1) {
      if (results[index].status === "rejected") markQuoteFailure(symbols[index], results[index].reason);
    }
    const now = new Date().toLocaleString();
    if (ok === symbols.length) {
      setStatus(root, `Updated ${ok} delayed intraday quotes on page open at ${now}. Auto-refreshes while open.`, "ok");
    } else if (ok > 0) {
      setStatus(root, `Updated ${ok}/${symbols.length} quotes at ${now}; ${failures.length} source request(s) failed, so stale rendered values remain where needed.`, "partial");
    } else {
      setStatus(root, `Live quote source blocked or unavailable at ${now}; showing stale rendered market data with visible timestamps.`, "failed");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    refreshMarketWatch();
    window.setInterval(refreshMarketWatch, REFRESH_MS);
  });
})();
