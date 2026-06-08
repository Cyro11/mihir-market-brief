#!/usr/bin/env python3
"""Generate an OpenBB-backed market pack for The Opening Ledger.

The script prints JSON to stdout. It intentionally redirects OpenBB's import-time
extension messages to stderr so Node can parse stdout cleanly.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import sys
from datetime import datetime, timezone
from typing import Any

import pandas as pd

with contextlib.redirect_stdout(sys.stderr):
    from openbb import obb


INDICES = [
    ("SPY", "S&P 500"),
    ("QQQ", "Nasdaq 100"),
    ("IWM", "Russell 2000"),
    ("DIA", "Dow Industrials"),
]

SECTORS = [
    ("XLK", "Technology"),
    ("XLF", "Financials"),
    ("XLE", "Energy"),
    ("XLV", "Health Care"),
    ("XLY", "Consumer Discretionary"),
    ("XLP", "Consumer Staples"),
    ("XLI", "Industrials"),
    ("XLU", "Utilities"),
    ("XLB", "Materials"),
    ("XLRE", "Real Estate"),
]

WATCHLIST = [
    ("AAPL", "Apple"),
    ("MSFT", "Microsoft"),
    ("NVDA", "Nvidia"),
    ("AMZN", "Amazon"),
    ("META", "Meta"),
    ("GOOGL", "Alphabet"),
    ("TSLA", "Tesla"),
    ("JPM", "JPMorgan"),
    ("GS", "Goldman Sachs"),
    ("BAC", "Bank of America"),
    ("XOM", "Exxon Mobil"),
    ("CVX", "Chevron"),
    ("BX", "Blackstone"),
    ("KKR", "KKR"),
    ("APO", "Apollo"),
    ("OWL", "Blue Owl"),
    ("ARCC", "Ares Capital"),
    ("COIN", "Coinbase"),
    ("MSTR", "Strategy"),
]


def clean_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return round(number, 4)


def pct(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return round(((current - previous) / previous) * 100, 2)


def value_n_sessions_ago(series: pd.Series, sessions: int) -> float | None:
    if len(series) <= sessions:
        return None
    return clean_number(series.iloc[-1 - sessions])


def fetch_symbol(symbol: str, label: str, run_date: str, start_date: str) -> dict[str, Any]:
    with contextlib.redirect_stdout(sys.stderr):
        result = obb.equity.price.historical(symbol, provider="yfinance", start_date=start_date)
    df = result.to_df().copy()
    if df.empty:
        raise RuntimeError(f"{symbol} returned no rows")

    df.index = pd.to_datetime(df.index).date
    cutoff = datetime.fromisoformat(run_date).date()
    df = df[df.index <= cutoff]
    df = df.dropna(subset=["close"])
    if len(df) < 2:
        raise RuntimeError(f"{symbol} returned fewer than two observations through {run_date}")

    close = df["close"].astype(float)
    volume = df["volume"].astype(float) if "volume" in df.columns else pd.Series(dtype=float)
    last = clean_number(close.iloc[-1])
    previous = clean_number(close.iloc[-2])
    one_week_ago = value_n_sessions_ago(close, 5)
    one_month_ago = value_n_sessions_ago(close, 21)
    first = clean_number(close.iloc[0])
    vol_last = clean_number(volume.iloc[-1]) if len(volume) else None
    vol_avg_20 = clean_number(volume.tail(21).iloc[:-1].mean()) if len(volume) >= 21 else None
    volume_ratio = round(vol_last / vol_avg_20, 2) if vol_last and vol_avg_20 else None

    return {
        "symbol": symbol,
        "label": label,
        "latestDate": close.index[-1].isoformat(),
        "lastClose": last,
        "oneDayPct": pct(last, previous),
        "fiveDayPct": pct(last, one_week_ago),
        "oneMonthPct": pct(last, one_month_ago),
        "ytdPct": pct(last, first),
        "volume": vol_last,
        "volumeVs20DayAvg": volume_ratio,
        "source": "OpenBB / Yahoo Finance provider",
        "url": f"https://finance.yahoo.com/quote/{symbol}",
    }


def fetch_group(group: list[tuple[str, str]], run_date: str, start_date: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    rows = []
    failures = []
    for symbol, label in group:
        try:
            rows.append(fetch_symbol(symbol, label, run_date, start_date))
        except Exception as exc:  # noqa: BLE001 - keep the newsletter pipeline non-blocking.
            failures.append({"id": symbol, "message": str(exc)})
    return rows, failures


def leader_laggard(rows: list[dict[str, Any]], field: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    scored = [row for row in rows if isinstance(row.get(field), (int, float))]
    if not scored:
        return None, None
    ordered = sorted(scored, key=lambda row: row[field], reverse=True)
    return ordered[0], ordered[-1]


def build_summary(indices: list[dict[str, Any]], sectors: list[dict[str, Any]], watchlist: list[dict[str, Any]]) -> dict[str, str]:
    spy = next((row for row in indices if row["symbol"] == "SPY"), None)
    qqq = next((row for row in indices if row["symbol"] == "QQQ"), None)
    iwm = next((row for row in indices if row["symbol"] == "IWM"), None)
    sector_leader, sector_laggard = leader_laggard(sectors, "oneDayPct")
    watch_leader, watch_laggard = leader_laggard(watchlist, "oneDayPct")

    spy_move = spy.get("oneDayPct") if spy else None
    qqq_move = qqq.get("oneDayPct") if qqq else None
    iwm_move = iwm.get("oneDayPct") if iwm else None

    if spy_move is None:
        risk_tone = "Mixed: broad-index data was unavailable, so use the sector and watchlist boards as context only."
    elif spy_move >= 0.4 and (qqq_move or 0) >= spy_move:
        risk_tone = "Risk-on growth tape: large-cap growth is leading the broad market."
    elif spy_move <= -0.4 and (iwm_move or 0) <= spy_move:
        risk_tone = "Risk-off tape: small caps are underperforming into the broad-market move."
    elif iwm_move is not None and iwm_move > spy_move + 0.5:
        risk_tone = "Cyclical/breadth improvement: small caps are beating the S&P 500."
    else:
        risk_tone = "Balanced tape: index moves are not showing a clean one-factor leadership signal."

    leadership = "Sector leadership was not available."
    if sector_leader and sector_laggard:
        leadership = (
            f"Sector leadership: {sector_leader['label']} led at {sector_leader['oneDayPct']:+.2f}%, "
            f"while {sector_laggard['label']} lagged at {sector_laggard['oneDayPct']:+.2f}%."
        )

    movers = "Watchlist movers were not available."
    if watch_leader and watch_laggard:
        movers = (
            f"Watchlist extremes: {watch_leader['symbol']} {watch_leader['oneDayPct']:+.2f}% vs. "
            f"{watch_laggard['symbol']} {watch_laggard['oneDayPct']:+.2f}%."
        )

    return {
        "headline": f"{risk_tone} {leadership}",
        "riskTone": risk_tone,
        "leadership": leadership,
        "movers": movers,
        "watchNext": "Check whether leadership broadens beyond the first index/sector leaders, and whether watchlist volume confirms the price move.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="Edition date, YYYY-MM-DD")
    parser.add_argument("--start-date", default=None, help="Historical pull start date")
    args = parser.parse_args()

    run_date = args.date
    start_date = args.start_date or f"{run_date[:4]}-01-01"

    indices, index_failures = fetch_group(INDICES, run_date, start_date)
    sectors, sector_failures = fetch_group(SECTORS, run_date, start_date)
    watchlist, watchlist_failures = fetch_group(WATCHLIST, run_date, start_date)

    payload = {
        "runDate": run_date,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "OpenBB equity.price.historical(provider='yfinance')",
        "sourceNote": "OpenBB market pack uses Yahoo Finance through OpenBB as market context, not live trading data or investment advice.",
        "indices": indices,
        "sectors": sectors,
        "watchlist": sorted(
            watchlist,
            key=lambda row: abs(row.get("oneDayPct") or 0),
            reverse=True,
        ),
        "summary": build_summary(indices, sectors, watchlist),
        "sourceTrail": [
            {"source": "OpenBB", "url": "https://github.com/OpenBB-finance/OpenBB"},
            {"source": "Yahoo Finance", "url": "https://finance.yahoo.com/"},
        ],
        "failures": index_failures + sector_failures + watchlist_failures,
    }
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
