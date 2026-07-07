import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.join(rootDir, "data");
export const generatedDir = path.join(dataDir, "generated");
export const sourcesDir = path.join(dataDir, "sources");
export const marketDataDir = path.join(dataDir, "market-data");
export const calendarDir = path.join(dataDir, "calendar");
export const candidatesDir = path.join(dataDir, "candidates");
export const analysisDir = path.join(dataDir, "analysis");
export const editionsDir = path.join(dataDir, "editions");
export const reviewsDir = path.join(dataDir, "reviews");
export const issuesDir = path.join(rootDir, "issues");

export const sourceQuality = {
  official: 5,
  company: 4,
  reputable: 4,
  market_data: 4,
  background: 2
};

export const topicBankerWeights = {
  rates: 5,
  inflation: 5,
  macro: 4,
  fed: 5,
  deals: 5,
  filings: 5,
  credit: 5,
  ai: 4,
  capex: 4,
  companies: 4,
  markets: 4,
  private_markets: 5,
  private_equity: 5,
  private_credit: 5,
  ipo: 5,
  breaking: 6,
  regulation: 2,
  commodities: 3,
  consumer: 3
};

export const feedItemLimit = Number.parseInt(process.env.SOURCE_FEED_ITEM_LIMIT || "40", 10);

export const sourceFeeds = [
  {
    id: "federal-reserve-press",
    name: "Federal Reserve",
    sourceType: "official",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    topics: ["fed", "rates", "macro"]
  },
  {
    id: "bea-news",
    name: "BEA",
    sourceType: "official",
    url: "https://www.bea.gov/news/current-releases",
    mode: "bea-current-releases",
    topics: ["macro", "inflation"]
  },
  {
    id: "bls-cpi",
    name: "BLS CPI",
    sourceType: "official",
    url: "https://www.bls.gov/news.release/cpi.nr0.htm",
    mode: "bls-release-page",
    topics: ["macro", "inflation", "rates", "fed"]
  },
  {
    id: "bls-ppi",
    name: "BLS PPI",
    sourceType: "official",
    url: "https://www.bls.gov/news.release/ppi.nr0.htm",
    mode: "bls-release-page",
    topics: ["macro", "inflation", "rates", "fed"]
  },
  {
    id: "bls-employment",
    name: "BLS Employment Situation",
    sourceType: "official",
    url: "https://www.bls.gov/news.release/empsit.nr0.htm",
    mode: "bls-release-page",
    topics: ["macro", "employment", "rates", "fed"]
  },
  {
    id: "sec-current-events",
    name: "SEC",
    sourceType: "official",
    url: "https://www.sec.gov/news/pressreleases.rss",
    topics: ["regulation"]
  },
  {
    id: "yahoo-finance-news",
    name: "Yahoo Finance",
    sourceType: "reputable",
    url: "https://finance.yahoo.com/news/rssindex",
    topics: ["markets", "companies"]
  },
  {
    id: "cnbc-finance",
    name: "CNBC Finance",
    sourceType: "reputable",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    topics: ["markets", "companies", "macro"]
  },
  {
    id: "marketwatch-top-stories",
    name: "MarketWatch Top Stories",
    sourceType: "reputable",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    topics: ["markets", "companies", "macro"]
  },
  {
    id: "investing-com-news",
    name: "Investing.com News",
    sourceType: "reputable",
    url: "https://www.investing.com/rss/news.rss",
    topics: ["markets", "macro", "companies"]
  },
  // TODO: Add Reuters/AP business RSS only when a stable XML endpoint is verified fetchable.
  {
    id: "private-equity-public-proxies",
    name: "Yahoo Finance / Public PE Managers",
    sourceType: "reputable",
    url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=BX,KKR,APO,CG&region=US&lang=en-US",
    requiredTextPattern: /\b(blackstone|bx|kkr|apollo|apo|carlyle|cg)\b/i,
    topics: ["private_markets", "private_equity", "markets", "companies"]
  },
  {
    id: "private-credit-public-proxies",
    name: "Yahoo Finance / Private Credit Proxies",
    sourceType: "reputable",
    url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=ARES,OWL,BXSL,ARCC&region=US&lang=en-US",
    requiredTextPattern: /\b(ares|ares capital|arcc|blue owl|owl|bxsl|blackstone secured lending|bdc|private credit|direct lending)\b/i,
    topics: ["private_markets", "private_credit", "credit", "markets"]
  },
  {
    id: "prnewswire-private-equity",
    name: "PR Newswire Private Equity",
    sourceType: "company",
    url: "https://www.prnewswire.com/rss/private-equity-list.rss",
    topics: ["private_markets", "private_equity", "deals"]
  }
];
