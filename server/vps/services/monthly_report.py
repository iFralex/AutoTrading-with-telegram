"""
Monthly report PDF generator — SignalFlow AI.

Requires: fpdf2>=2.7.0, matplotlib>=3.7.0.

PDF structure (up to 7 pages):
  1. Cover + Key metrics + Extended benchmarks + 6-month table
  2. Charts (equity curve, daily P&L, 6-month comparison)
  3. Symbol analysis (table + bar + pie charts) + Risk metrics + Execution quality
  4. Telegram channel comparison (only if >1 active channel)
  5. Full trade list
  6. AI analysis (5 sections, includes benchmark evaluation and channel comparison)
"""

from __future__ import annotations

import asyncio
import functools
import io
import json as _json
import logging
import urllib.request
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    _MPL_OK = True
except ImportError:
    _MPL_OK = False

try:
    from fpdf import FPDF
    _PDF_OK = True
except ImportError:
    _PDF_OK = False

_MONTH_EN = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

# ── Colour palette ────────────────────────────────────────────────────────────
_NAVY   = (15, 23, 62)
_BLUE   = (30, 80, 160)
_WHITE  = (255, 255, 255)
_LIGHT  = (245, 247, 252)
_ALT    = (235, 239, 248)
_GREEN  = (22, 163, 74)
_RED    = (220, 38, 38)
_AMBER  = (217, 119, 6)
_MUTED  = (107, 114, 128)
_DARK   = (17, 24, 39)
_BORDER = (209, 213, 219)

_PIE_PALETTE = ["#1e50a0", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#6b7280"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pnl_str(v: float) -> str:
    return f"+{v:.2f}" if v >= 0 else f"{v:.2f}"


def _pct_str(v: float | None) -> str:
    if v is None:
        return "N/A"
    return f"+{v:.1f}%" if v >= 0 else f"{v:.1f}%"


def _fetch_url(url: str) -> Any:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return _json.loads(resp.read())
    except Exception:
        return None


async def _fetch_all_benchmarks(year: int, month: int) -> dict[str, float | None]:
    """BTC (Binance), Gold, S&P500, NASDAQ, EUR/USD (Yahoo Finance v8)."""
    loop = asyncio.get_event_loop()

    async def _btc() -> float | None:
        try:
            raw = await loop.run_in_executor(
                None, _fetch_url,
                "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=3",
            )
            if raw and len(raw) >= 2:
                prev = float(raw[-2][4])
                curr = float(raw[-1][4])
                if prev > 0:
                    return round((curr - prev) / prev * 100, 2)
        except Exception:
            pass
        return None

    async def _yahoo(ticker: str) -> float | None:
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1mo&range=2mo"
            raw = await loop.run_in_executor(None, _fetch_url, url)
            if raw:
                closes = (
                    raw.get("chart", {})
                       .get("result", [{}])[0]
                       .get("indicators", {})
                       .get("quote", [{}])[0]
                       .get("close", [])
                )
                if len(closes) >= 2 and closes[-2] and closes[-1]:
                    return round((closes[-1] - closes[-2]) / closes[-2] * 100, 2)
        except Exception:
            pass
        return None

    btc_ret, gold_ret, sp500_ret, ndx_ret, eurusd_ret = await asyncio.gather(
        _btc(),
        _yahoo("GC%3DF"),
        _yahoo("%5EGSPC"),
        _yahoo("%5EIXIC"),
        _yahoo("EURUSD%3DX"),
    )
    return {
        "btc":    btc_ret,
        "gold":   gold_ret,
        "sp500":  sp500_ret,
        "nasdaq": ndx_ret,
        "eurusd": eurusd_ret,
    }


# ── Risk metrics ──────────────────────────────────────────────────────────────

def _compute_risk_metrics(equity_curve: list[dict]) -> dict:
    if not equity_curve:
        return {"max_drawdown": 0.0, "max_drawdown_pct": 0.0,
                "sharpe_approx": None, "recovery_factor": None, "volatility_daily": 0.0}

    import math
    daily_pnls  = [e["daily_pnl"] for e in equity_curve]
    cumulatives = [e["cumulative_pnl"] for e in equity_curve]

    peak = 0.0
    max_dd = 0.0
    max_dd_pct = 0.0
    for c in cumulatives:
        if c > peak:
            peak = c
        dd = peak - c
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = (dd / peak * 100) if peak > 0 else 0.0

    sharpe = None
    if len(daily_pnls) >= 3:
        try:
            mean = sum(daily_pnls) / len(daily_pnls)
            variance = sum((x - mean) ** 2 for x in daily_pnls) / len(daily_pnls)
            std = math.sqrt(variance)
            if std > 0:
                sharpe = round(mean / std * math.sqrt(252), 2)
        except Exception:
            pass

    vol = 0.0
    if len(daily_pnls) >= 2:
        try:
            mean = sum(daily_pnls) / len(daily_pnls)
            vol  = round(math.sqrt(sum((x - mean) ** 2 for x in daily_pnls) / len(daily_pnls)), 2)
        except Exception:
            pass

    total_profit = cumulatives[-1] if cumulatives else 0.0
    recovery = round(total_profit / max_dd, 2) if max_dd > 0 else None

    return {
        "max_drawdown":     round(max_dd, 2),
        "max_drawdown_pct": round(max_dd_pct, 1),
        "sharpe_approx":    sharpe,
        "recovery_factor":  recovery,
        "volatility_daily": vol,
    }


# ── Chart generators ──────────────────────────────────────────────────────────

def _equity_chart(equity_curve: list[dict]) -> bytes | None:
    if not _MPL_OK or not equity_curve:
        return None
    try:
        days  = [e["day"][-2:] for e in equity_curve]
        cumul = [e["cumulative_pnl"] for e in equity_curve]

        fig, ax = plt.subplots(figsize=(9, 2.8))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")

        color     = _GREEN if (cumul[-1] if cumul else 0) >= 0 else _RED
        color_hex = "#{:02x}{:02x}{:02x}".format(*color)
        ax.plot(days, cumul, color=color_hex, linewidth=2.2)
        ax.fill_between(range(len(cumul)), cumul, 0, color=color_hex, alpha=0.12)
        ax.axhline(0, color="#9ca3af", linewidth=0.8, linestyle="--")
        ax.set_xlabel("Day of month", fontsize=8, color="#6b7280")
        ax.set_ylabel("Cumulative P&L ($)", fontsize=8, color="#6b7280")
        ax.tick_params(labelsize=7, colors="#6b7280")
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color("#e5e7eb")
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:+.0f}"))
        ax.xaxis.set_major_locator(mticker.MaxNLocator(integer=True, nbins=10))

        fig.tight_layout(pad=0.6)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("equity_chart error: %s", exc)
        return None


def _daily_pnl_chart(equity_curve: list[dict]) -> bytes | None:
    if not _MPL_OK or not equity_curve:
        return None
    try:
        days   = [e["day"][-2:] for e in equity_curve]
        pnls   = [e["daily_pnl"] for e in equity_curve]
        colors = ["#16a34a" if p >= 0 else "#dc2626" for p in pnls]

        fig, ax = plt.subplots(figsize=(9, 2.4))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")
        ax.bar(days, pnls, color=colors, width=0.65)
        ax.axhline(0, color="#9ca3af", linewidth=0.8)
        ax.set_xlabel("Day of month", fontsize=8, color="#6b7280")
        ax.set_ylabel("Daily P&L ($)", fontsize=8, color="#6b7280")
        ax.tick_params(labelsize=7, colors="#6b7280")
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color("#e5e7eb")
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:+.0f}"))
        ax.xaxis.set_major_locator(mticker.MaxNLocator(integer=True, nbins=10))

        fig.tight_layout(pad=0.6)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("daily_pnl_chart error: %s", exc)
        return None


def _monthly_comparison_chart(last_6: list[dict]) -> bytes | None:
    if not _MPL_OK or not last_6:
        return None
    try:
        labels = [f"{m['month']:02d}/{str(m['year'])[-2:]}" for m in last_6]
        pnls   = [m["total_profit"] for m in last_6]
        colors = ["#16a34a" if p >= 0 else "#dc2626" for p in pnls]

        fig, ax = plt.subplots(figsize=(9, 2.8))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")
        bars = ax.bar(labels, pnls, color=colors, width=0.55)
        ax.axhline(0, color="#9ca3af", linewidth=0.8)

        pmax = max(pnls) if pnls else 1
        pmin = min(pnls) if pnls else -1
        for bar, v in zip(bars, pnls):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                v + (pmax * 0.04 if v >= 0 else pmin * 0.04),
                f"{v:+.0f}",
                ha="center", va="bottom" if v >= 0 else "top",
                fontsize=7, color="#374151",
            )
        ax.set_ylabel("P&L ($)", fontsize=8, color="#6b7280")
        ax.tick_params(labelsize=8, colors="#6b7280")
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color("#e5e7eb")
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:+.0f}"))

        fig.tight_layout(pad=0.6)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("monthly_comparison_chart error: %s", exc)
        return None


def _symbol_chart(by_symbol: list[dict]) -> bytes | None:
    if not _MPL_OK or not by_symbol:
        return None
    try:
        top     = by_symbol[:10]
        symbols = [s["symbol"] for s in top]
        pnls    = [s["total_profit"] for s in top]
        colors  = ["#16a34a" if p >= 0 else "#dc2626" for p in pnls]

        fig, ax = plt.subplots(figsize=(9, max(2.2, len(symbols) * 0.5)))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")
        bars = ax.barh(symbols, pnls, color=colors, height=0.55)
        ax.axvline(0, color="#9ca3af", linewidth=0.8)

        for bar, v in zip(bars, pnls):
            ax.text(
                v + (max(abs(p) for p in pnls) * 0.02 * (1 if v >= 0 else -1)),
                bar.get_y() + bar.get_height() / 2,
                f"{v:+.2f}",
                va="center", ha="left" if v >= 0 else "right",
                fontsize=7, color="#374151",
            )
        ax.set_xlabel("P&L ($)", fontsize=8, color="#6b7280")
        ax.tick_params(labelsize=7, colors="#374151")
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color("#e5e7eb")
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:+.0f}"))
        ax.invert_yaxis()

        fig.tight_layout(pad=0.6)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("symbol_chart error: %s", exc)
        return None


def _pie_outcomes_chart(tp: int, sl: int, manual: int) -> bytes | None:
    if not _MPL_OK:
        return None
    total = tp + sl + manual
    if total == 0:
        return None
    try:
        items = [("TP", tp, "#16a34a"), ("SL", sl, "#dc2626"), ("Manual", manual, "#d97706")]
        labels, sizes, colors = [], [], []
        for lbl, val, col in items:
            if val > 0:
                labels.append(f"{lbl}\n{val} ({round(val/total*100)}%)")
                sizes.append(val)
                colors.append(col)

        fig, ax = plt.subplots(figsize=(4.5, 3.2))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")
        wedges, _ = ax.pie(
            sizes, labels=None, colors=colors,
            startangle=90, wedgeprops={"width": 0.55, "edgecolor": "white", "linewidth": 2},
        )
        ax.legend(wedges, labels, loc="center left", bbox_to_anchor=(1, 0, 0.5, 1), fontsize=8)
        ax.set_title("Trade Outcomes", fontsize=9, color="#374151", pad=8)

        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("pie_outcomes_chart error: %s", exc)
        return None


def _pie_symbols_chart(by_symbol: list[dict]) -> bytes | None:
    if not _MPL_OK or not by_symbol:
        return None
    try:
        TOP_N  = 7
        top    = by_symbol[:TOP_N]
        others = by_symbol[TOP_N:]
        labels = [s["symbol"] for s in top]
        sizes  = [s["total"] for s in top]
        if others:
            labels.append("Others")
            sizes.append(sum(s["total"] for s in others))

        colors = _PIE_PALETTE[:len(sizes)]

        fig, ax = plt.subplots(figsize=(4.5, 3.2))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")
        wedges, _ = ax.pie(
            sizes, labels=None, colors=colors,
            startangle=90, wedgeprops={"width": 0.55, "edgecolor": "white", "linewidth": 2},
        )
        legend_labels = [f"{l} ({n})" for l, n in zip(labels, sizes)]
        ax.legend(wedges, legend_labels, loc="center left", bbox_to_anchor=(1, 0, 0.5, 1), fontsize=7.5)
        ax.set_title("Trades by Symbol", fontsize=9, color="#374151", pad=8)

        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("pie_symbols_chart error: %s", exc)
        return None


def _groups_bar_chart(groups_stats: list[dict]) -> bytes | None:
    if not _MPL_OK or not groups_stats:
        return None
    try:
        names  = [g["group_name"]   for g in groups_stats]
        pnls   = [g["total_profit"] for g in groups_stats]
        colors = ["#16a34a" if p >= 0 else "#dc2626" for p in pnls]

        fig, ax = plt.subplots(figsize=(9, max(2.0, len(names) * 0.7)))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")
        bars = ax.barh(names, pnls, color=colors, height=0.5)
        ax.axvline(0, color="#9ca3af", linewidth=0.8)
        pmax = max(abs(p) for p in pnls) or 1
        for bar, v in zip(bars, pnls):
            ax.text(
                v + pmax * 0.02 * (1 if v >= 0 else -1),
                bar.get_y() + bar.get_height() / 2,
                f"{v:+.2f}",
                va="center", ha="left" if v >= 0 else "right",
                fontsize=7.5, color="#374151",
            )
        ax.set_xlabel("P&L ($)", fontsize=8, color="#6b7280")
        ax.tick_params(labelsize=7.5, colors="#374151")
        ax.spines[["top", "right"]].set_visible(False)
        ax.spines[["left", "bottom"]].set_color("#e5e7eb")
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:+.0f}"))
        ax.invert_yaxis()

        fig.tight_layout(pad=0.6)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("groups_bar_chart error: %s", exc)
        return None


def _groups_pie_chart(groups_stats: list[dict]) -> bytes | None:
    if not _MPL_OK or not groups_stats:
        return None
    try:
        labels = [g["group_name"]   for g in groups_stats]
        sizes  = [g["total_trades"] for g in groups_stats]
        colors = _PIE_PALETTE[:len(sizes)]

        fig, ax = plt.subplots(figsize=(4.5, 3.2))
        fig.patch.set_facecolor("#f8fafc")
        ax.set_facecolor("#f8fafc")
        wedges, _ = ax.pie(
            sizes, labels=None, colors=colors,
            startangle=90, wedgeprops={"width": 0.55, "edgecolor": "white", "linewidth": 2},
        )
        legend_labels = [f"{l} ({n} trades)" for l, n in zip(labels, sizes)]
        ax.legend(wedges, legend_labels, loc="center left", bbox_to_anchor=(1, 0, 0.5, 1), fontsize=7.5)
        ax.set_title("Trades by Channel", fontsize=9, color="#374151", pad=8)

        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
        buf.seek(0)
        return buf.read()
    except Exception as exc:
        logger.warning("groups_pie_chart error: %s", exc)
        return None


# ── Trust Score (trade-data-only, without exec_rate from signal_logs) ─────────

def _compute_group_score(g: dict) -> float:
    """
    Same formula as _compute_trust_score in dashboard.py but without signal_logs:
      Win Rate (0-35) · PF (0-25) · Volume (0-15) · TP rate (0-15) · Streak (0-10)
    TP rate replaces exec_rate as an execution quality proxy.
    """
    total = g.get("total_trades", 0)
    if total == 0:
        return 0.0
    wr     = g.get("win_rate", 0)
    pf     = g.get("profit_factor") or 0
    max_cl = g.get("max_consecutive_losses", 0)
    tp     = g.get("tp_count", 0)
    tp_rate = tp / total * 100

    score = (
        wr * 0.35 +
        min(pf / 3.0, 1.0) * 25 +
        min(total / 50.0, 1.0) * 15 +
        tp_rate * 0.15 +
        10.0 * (1.0 - min(max_cl / 10.0, 1.0))
    )
    return round(min(max(score, 0.0), 100.0), 1)


def _score_label(score: float) -> str:
    if score >= 75: return "Excellent"
    if score >= 55: return "Good"
    if score >= 35: return "Average"
    return "Low"


def _score_color(score: float) -> tuple:
    if score >= 75: return _GREEN
    if score >= 55: return _AMBER
    return _RED


# ── PDF builder ───────────────────────────────────────────────────────────────

class _PDF(FPDF):

    def _set_fill(self, rgb: tuple) -> None:
        self.set_fill_color(*rgb)

    def _set_text(self, rgb: tuple) -> None:
        self.set_text_color(*rgb)

    def _set_draw(self, rgb: tuple) -> None:
        self.set_draw_color(*rgb)

    def section_title(self, text: str) -> None:
        self.ln(3)
        self._set_fill(_NAVY)
        self._set_text(_WHITE)
        self.set_font("Helvetica", style="B", size=10)
        self.cell(0, 7, f"  {text}", fill=True, ln=True)
        self.ln(2)
        self._set_text(_DARK)

    def metric_card(self, label: str, value: str, positive: bool | None = None,
                    x: float | None = None, w: float = 45.0) -> None:
        if x is not None:
            self.set_x(x)
        self._set_fill(_LIGHT)
        self._set_draw(_BORDER)
        self.cell(w, 14, "", border=1, fill=True, ln=False)
        self.set_x(self.get_x() - w)
        self.set_font("Helvetica", size=7)
        self._set_text(_MUTED)
        self.cell(w, 6, f"  {label}", ln=False, align="L")
        self.set_x(self.get_x() - w)
        self.set_y(self.get_y() + 6)
        if positive is True:
            self._set_text(_GREEN)
        elif positive is False:
            self._set_text(_RED)
        else:
            self._set_text(_DARK)
        self.set_font("Helvetica", style="B", size=10)
        self.cell(w, 8, f"  {value}", ln=False, align="L")
        self.set_y(self.get_y() - 6)


def _build_pdf(
    title: str,
    stats: dict,
    trades: list[dict],
    last_6: list[dict],
    benchmarks: dict,
    risk: dict,
    ai_text: str,
    equity_img: bytes | None,
    pnl_bar_img: bytes | None,
    monthly_img: bytes | None,
    symbol_img: bytes | None,
    *,
    groups_stats: list[dict] | None = None,
    prev_groups_stats: list[dict] | None = None,
    pie_outcomes_img: bytes | None = None,
    pie_symbols_img: bytes | None = None,
    groups_bar_img: bytes | None = None,
    groups_pie_img: bytes | None = None,
) -> bytes:
    pdf = _PDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=12)
    pdf.set_margins(10, 10, 10)

    total    = stats.get("total_trades", 0)
    pnl      = stats.get("total_profit", 0.0)
    wr       = stats.get("win_rate", 0.0)
    pf       = stats.get("profit_factor")
    best     = stats.get("best_trade", 0.0)
    worst    = stats.get("worst_trade", 0.0)
    avg_win  = stats.get("avg_win", 0.0)
    avg_los  = stats.get("avg_loss", 0.0)
    tp_count = stats.get("tp_count", 0)
    sl_count = stats.get("sl_count", 0)
    man_count= stats.get("manual_count", 0)
    by_symbol= stats.get("by_symbol", [])
    max_cw   = stats.get("max_consecutive_wins", 0)
    max_cl   = stats.get("max_consecutive_losses", 0)
    act_days = stats.get("active_trading_days", 0)
    groups   = groups_stats or []

    # ── Page 1: Cover + Metrics + Benchmarks + 6-month table ─────────────────
    pdf.add_page()

    pdf.set_fill_color(*_NAVY)
    pdf.rect(0, 0, 210, 40, style="F")
    pdf.set_y(8)
    pdf.set_text_color(*_WHITE)
    pdf.set_font("Helvetica", style="B", size=20)
    pdf.cell(0, 10, "MONTHLY REPORT", align="C", ln=True)
    pdf.set_font("Helvetica", style="B", size=14)
    pdf.cell(0, 8, title.upper(), align="C", ln=True)
    pdf.set_font("Helvetica", size=8)
    pdf.set_text_color(180, 195, 220)
    pdf.cell(0, 6, f"Generated on {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')} UTC",
             align="C", ln=True)
    pdf.ln(12)
    pdf.set_text_color(*_DARK)

    pnl_color = _GREEN if pnl >= 0 else _RED
    pdf.set_fill_color(*pnl_color)
    pdf.set_text_color(*_WHITE)
    pdf.set_font("Helvetica", style="B", size=14)
    pdf.cell(0, 12, f"  Net P&L for Period:  {_pnl_str(pnl)}", fill=True, ln=True, align="L")
    pdf.ln(4)

    pdf.set_text_color(*_DARK)
    cx     = 10.0
    card_w = 45.0
    gap    = 2.5
    prev_pnl = last_6[-2]["total_profit"] if len(last_6) >= 2 else None
    for label, val, pos in [
        ("Total Trades",   str(total),                          None),
        ("Win Rate",       f"{wr:.1f}%",                        wr >= 50),
        ("Profit Factor",  f"{pf:.2f}" if pf else "N/A",        (pf or 0) >= 1.5 if pf else None),
        ("Prev. Month",    _pnl_str(prev_pnl) if prev_pnl is not None else "N/A",
                           None if prev_pnl is None else prev_pnl >= 0),
    ]:
        pdf.metric_card(label, val, pos, x=cx, w=card_w)
        cx += card_w + gap
    pdf.ln(16)

    cx = 10.0
    for label, val, pos in [
        ("Best Trade",   _pnl_str(best),    True),
        ("Worst Trade",  _pnl_str(worst),   False),
        ("Avg Win",      _pnl_str(avg_win), True),
        ("Avg Loss",     _pnl_str(avg_los), False),
    ]:
        pdf.metric_card(label, val, pos, x=cx, w=card_w)
        cx += card_w + gap
    pdf.ln(16)

    cx     = 10.0
    max_dd = risk.get("max_drawdown", 0.0)
    sharpe = risk.get("sharpe_approx")
    for label, val, pos in [
        ("Max Drawdown",     f"-{max_dd:.2f}",              False if max_dd > 0 else None),
        ("Sharpe (approx.)", f"{sharpe:.2f}" if sharpe else "N/A",
                             (sharpe or 0) >= 1 if sharpe else None),
        ("Win Streak",       f"{max_cw} trades",            True  if max_cw >= 3 else None),
        ("Loss Streak",      f"{max_cl} trades",            False if max_cl >= 3 else None),
    ]:
        pdf.metric_card(label, val, pos, x=cx, w=card_w)
        cx += card_w + gap
    pdf.ln(16)

    # Benchmark table
    pdf.section_title("Monthly Benchmark Comparison")

    initial_balance_est = stats.get("gross_profit", 0) + abs(stats.get("gross_loss", 0))
    port_pct = round(pnl / initial_balance_est * 100, 1) if initial_balance_est > 0 else None

    bm_headers = [("Asset", 50), ("Monthly Return", 38), ("Alpha vs Portfolio", 50), ("Rating", 50)]
    pdf.set_font("Helvetica", style="B", size=8)
    pdf.set_fill_color(*_NAVY); pdf.set_text_color(*_WHITE)
    for h, w in bm_headers:
        pdf.cell(w, 7, h, border=1, fill=True, align="C")
    pdf.ln()

    bm_rows = [
        ("Your Portfolio", port_pct,              "portfolio"),
        ("Bitcoin (BTC)",  benchmarks.get("btc"),    "btc"),
        ("Gold",           benchmarks.get("gold"),   "gold"),
        ("S&P 500",        benchmarks.get("sp500"),  "sp500"),
        ("NASDAQ",         benchmarks.get("nasdaq"), "nasdaq"),
        ("EUR/USD",        benchmarks.get("eurusd"), "eurusd"),
    ]
    for i, (asset, ret_val, _key) in enumerate(bm_rows):
        ret_str = _pct_str(ret_val)
        if i == 0:
            ret_str   = _pct_str(port_pct)
            alpha_str = "—"
            rating    = "Portfolio"
        else:
            if port_pct is not None and ret_val is not None:
                alpha     = port_pct - ret_val
                alpha_str = _pct_str(alpha)
                rating    = "Beats Benchmark" if alpha > 0 else ("On Par" if abs(alpha) < 1 else "Below Benchmark")
            else:
                alpha_str = "—"
                rating    = "N/A"

        pdf.set_fill_color(*(_LIGHT if i % 2 == 0 else _WHITE))
        pdf.set_font("Helvetica", style="B" if i == 0 else "", size=8)
        pdf.set_text_color(*_DARK)
        pdf.cell(50, 6, f"  {asset}", border=1, fill=True, align="L")

        is_pos = isinstance(ret_str, str) and ret_str.startswith("+")
        is_neg = isinstance(ret_str, str) and ret_str.startswith("-")
        pdf.set_text_color(*(_GREEN if is_pos else (_RED if is_neg else _DARK)))
        pdf.cell(38, 6, ret_str, border=1, fill=True, align="C")

        a_pos = alpha_str.startswith("+")
        a_neg = alpha_str.startswith("-")
        pdf.set_text_color(*(_GREEN if a_pos else (_RED if a_neg else _DARK)))
        pdf.cell(50, 6, alpha_str, border=1, fill=True, align="C")

        pdf.set_text_color(*(_GREEN if rating == "Beats Benchmark" else
                             (_RED if rating == "Below Benchmark" else _DARK)))
        pdf.set_font("Helvetica", size=7)
        pdf.cell(50, 6, rating, border=1, fill=True, align="C")
        pdf.ln()
    pdf.ln(4)

    # 6-month comparison table
    pdf.section_title("Last 6 Months")
    m_headers = [("Month", 32), ("Trades", 22), ("Win Rate", 28), ("P&L", 30),
                 ("PF", 22), ("Trend", 22), ("vs Prev.", 28)]
    pdf.set_font("Helvetica", style="B", size=8)
    pdf.set_fill_color(*_NAVY); pdf.set_text_color(*_WHITE)
    for h, w in m_headers:
        pdf.cell(w, 7, h, border=1, fill=True, align="C")
    pdf.ln()

    for i, ms in enumerate(last_6):
        is_current = (ms.get("year") == last_6[-1].get("year") and
                      ms.get("month") == last_6[-1].get("month"))
        prev_m = last_6[i - 1] if i > 0 else None
        mp     = ms["total_profit"]

        if prev_m is not None:
            delta     = mp - prev_m["total_profit"]
            trend_str = f"↑ +{delta:.0f}" if delta > 0 else (f"↓ {delta:.0f}" if delta < 0 else "→ 0")
            trend_col = _GREEN if delta > 0 else (_RED if delta < 0 else _MUTED)
        else:
            trend_str = "—"
            trend_col = _MUTED

        vs_prev_pct = ""
        if prev_m is not None and prev_m["total_profit"] != 0:
            pct_chg     = (mp - prev_m["total_profit"]) / abs(prev_m["total_profit"]) * 100
            vs_prev_pct = _pct_str(pct_chg)

        pdf.set_fill_color(*((_ALT if is_current else (_LIGHT if i % 2 == 0 else _WHITE))))
        pdf.set_font("Helvetica", style="B" if is_current else "", size=8)
        pdf.set_text_color(*_DARK)
        lbl = f"{_MONTH_EN[ms['month']-1][:3]} {ms['year']}" + (" ◀" if is_current else "")
        pdf.cell(32, 6, lbl, border=1, fill=True, align="L")
        pdf.cell(22, 6, str(ms["total_trades"]), border=1, fill=True, align="C")
        pdf.cell(28, 6, f"{ms['win_rate']:.1f}%", border=1, fill=True, align="C")
        pdf.set_text_color(*(_GREEN if mp >= 0 else _RED))
        pdf.cell(30, 6, _pnl_str(mp), border=1, fill=True, align="C")
        pdf.set_text_color(*_DARK)
        pdf.set_font("Helvetica", size=8)
        pf_m = ms.get("profit_factor")
        pdf.cell(22, 6, f"{pf_m:.2f}" if pf_m else "N/A", border=1, fill=True, align="C")
        pdf.set_text_color(*trend_col)
        pdf.cell(22, 6, trend_str, border=1, fill=True, align="C")
        pdf.set_text_color(*(_GREEN if vs_prev_pct.startswith("+") else
                             (_RED if vs_prev_pct.startswith("-") else _DARK)))
        pdf.cell(28, 6, vs_prev_pct or "—", border=1, fill=True, align="C")
        pdf.ln()

    # ── Page 2: Charts ────────────────────────────────────────────────────────
    pdf.add_page()
    pdf.section_title("Equity Curve — Cumulative P&L")
    if equity_img:
        pdf.image(io.BytesIO(equity_img), x=10, y=None, w=190)
    else:
        pdf.set_font("Helvetica", size=9); pdf.set_text_color(*_MUTED)
        pdf.cell(0, 10, "No data available.", ln=True, align="C")
    pdf.ln(4)

    pdf.section_title("Daily P&L")
    if pnl_bar_img:
        pdf.image(io.BytesIO(pnl_bar_img), x=10, y=None, w=190)
    else:
        pdf.set_font("Helvetica", size=9); pdf.set_text_color(*_MUTED)
        pdf.cell(0, 10, "No data available.", ln=True, align="C")
    pdf.ln(4)

    pdf.section_title("Monthly P&L — Last 6 Months")
    if monthly_img:
        pdf.image(io.BytesIO(monthly_img), x=10, y=None, w=190)
    else:
        pdf.set_font("Helvetica", size=9); pdf.set_text_color(*_MUTED)
        pdf.cell(0, 10, "No data available.", ln=True, align="C")

    # ── Page 3: Symbol analysis + Pie charts + Risk metrics ──────────────────
    pdf.add_page()
    pdf.section_title("Symbol Analysis")
    if by_symbol:
        sym_cols = [("Symbol",18),("Trades",14),("Win%",18),("Total P&L",24),
                    ("Avg P&L",22),("Best",20),("Worst",20),("TP%",16),("SL%",16)]
        pdf.set_font("Helvetica", style="B", size=7)
        pdf.set_fill_color(*_NAVY); pdf.set_text_color(*_WHITE)
        for h, w in sym_cols:
            pdf.cell(w, 6, h, border=1, fill=True, align="C")
        pdf.ln()
        for i, s in enumerate(by_symbol[:12]):
            t       = s["total"]
            tp_pct  = round(s["tp_count"] / t * 100, 0) if t else 0
            sl_pct  = round(s["sl_count"] / t * 100, 0) if t else 0
            sp      = s["total_profit"]
            pdf.set_fill_color(*(_LIGHT if i % 2 == 0 else _WHITE))
            pdf.set_font("Helvetica", style="B", size=7); pdf.set_text_color(*_DARK)
            pdf.cell(18, 5.5, s["symbol"], border=1, fill=True, align="C")
            pdf.set_font("Helvetica", size=7)
            pdf.cell(14, 5.5, str(t), border=1, fill=True, align="C")
            pdf.cell(18, 5.5, f"{s['win_rate']:.1f}%", border=1, fill=True, align="C")
            pdf.set_text_color(*(_GREEN if sp >= 0 else _RED))
            pdf.cell(24, 5.5, _pnl_str(sp), border=1, fill=True, align="C")
            ap = s["avg_profit"]
            pdf.set_text_color(*(_GREEN if ap >= 0 else _RED))
            pdf.cell(22, 5.5, _pnl_str(ap), border=1, fill=True, align="C")
            pdf.set_text_color(*_GREEN)
            pdf.cell(20, 5.5, _pnl_str(s["best_trade"]),  border=1, fill=True, align="C")
            pdf.set_text_color(*_RED)
            pdf.cell(20, 5.5, _pnl_str(s["worst_trade"]), border=1, fill=True, align="C")
            pdf.set_text_color(*_DARK)
            pdf.cell(16, 5.5, f"{int(tp_pct)}%", border=1, fill=True, align="C")
            pdf.cell(16, 5.5, f"{int(sl_pct)}%", border=1, fill=True, align="C")
            pdf.ln()
        pdf.ln(2)
        if symbol_img:
            pdf.image(io.BytesIO(symbol_img), x=10, y=None, w=190)
        pdf.ln(2)
    else:
        pdf.set_font("Helvetica", size=9); pdf.set_text_color(*_MUTED)
        pdf.cell(0, 10, "No trades in the period.", ln=True, align="C")

    # Side-by-side pie charts
    if pie_symbols_img or pie_outcomes_img:
        y_pie = pdf.get_y() + 2
        PIE_W = 90.0
        if pie_symbols_img:
            pdf.image(io.BytesIO(pie_symbols_img), x=10, y=y_pie, w=PIE_W)
        if pie_outcomes_img:
            pdf.image(io.BytesIO(pie_outcomes_img), x=108, y=y_pie, w=PIE_W)
        pdf.set_y(y_pie + 64)
        pdf.ln(2)

    # Risk metrics
    pdf.section_title("Risk Metrics")
    max_dd_pct = risk.get("max_drawdown_pct", 0.0)
    rec_f      = risk.get("recovery_factor")
    vol_d      = risk.get("volatility_daily", 0.0)
    sharpe_v   = risk.get("sharpe_approx")
    avg_per_day= round(total / act_days, 1) if act_days else 0.0

    risk_cx = 10.0
    for label, val, pos in [
        ("Max Drawdown",       f"-{max_dd:.2f} ({max_dd_pct:.1f}%)", False if max_dd > 0 else None),
        ("Recovery Factor",    f"{rec_f:.2f}" if rec_f else "N/A",    (rec_f or 0) >= 1 if rec_f else None),
        ("Sharpe (annualiz.)", f"{sharpe_v:.2f}" if sharpe_v else "N/A", (sharpe_v or 0) >= 1 if sharpe_v else None),
        ("Daily Volatility",   f"{vol_d:.2f}$",                       None),
    ]:
        pdf.metric_card(label, val, pos, x=risk_cx, w=44.0)
        risk_cx += 44.0 + 2.5
    pdf.ln(16)

    # Execution quality
    pdf.section_title("Execution Quality")
    exec_cx    = 10.0
    tot_closed = tp_count + sl_count + man_count or 1
    for label, val, pos in [
        ("Closed at TP",    f"{tp_count} ({round(tp_count/tot_closed*100)}%)",  True  if tp_count > sl_count else None),
        ("Closed at SL",    f"{sl_count} ({round(sl_count/tot_closed*100)}%)",  False if sl_count > tp_count else None),
        ("Manually Closed", f"{man_count} ({round(man_count/tot_closed*100)}%)", None),
        ("Trades per Day",  f"{avg_per_day} avg / {act_days} days",             None),
    ]:
        pdf.metric_card(label, val, pos, x=exec_cx, w=44.0)
        exec_cx += 44.0 + 2.5
    pdf.ln(16)

    # ── Page 4: Telegram channel comparison (only if >1 channel) ─────────────
    if groups:
        prev_lookup: dict[int, dict] = {
            g["group_id"]: g for g in (prev_groups_stats or [])
        }

        pdf.add_page()
        pdf.section_title(f"Telegram Channel Comparison ({len(groups)} channels)")

        g_cols = [
            ("Channel", 42), ("Trades", 14), ("Win%", 18), ("P&L", 24),
            ("PF", 16), ("Avg Win", 20), ("Avg Loss", 20), ("Score", 18), ("Δ Prev.", 18),
        ]
        pdf.set_font("Helvetica", style="B", size=7)
        pdf.set_fill_color(*_NAVY); pdf.set_text_color(*_WHITE)
        for h, w in g_cols:
            pdf.cell(w, 6, h, border=1, fill=True, align="C")
        pdf.ln()

        for i, g in enumerate(groups):
            gp_val = g["total_profit"]
            gpf    = g["profit_factor"]
            score  = _compute_group_score(g)
            slabel = _score_label(score)
            scol   = _score_color(score)

            prev_g     = prev_lookup.get(g["group_id"])
            prev_score = _compute_group_score(prev_g) if prev_g else None
            if prev_score is not None:
                delta     = round(score - prev_score, 1)
                delta_str = f"{'↑' if delta >= 0 else '↓'} {delta:+.1f}"
                delta_col = _GREEN if delta >= 0 else _RED
            else:
                delta_str = "New"
                delta_col = _MUTED

            pdf.set_fill_color(*(_LIGHT if i % 2 == 0 else _WHITE))
            pdf.set_font("Helvetica", style="B", size=7); pdf.set_text_color(*_DARK)
            pdf.cell(42, 5.5, g["group_name"][:21], border=1, fill=True, align="L")
            pdf.set_font("Helvetica", size=7)
            pdf.cell(14, 5.5, str(g["total_trades"]),         border=1, fill=True, align="C")
            wr_g = g["win_rate"]
            pdf.set_text_color(*(_GREEN if wr_g >= 50 else _RED))
            pdf.cell(18, 5.5, f"{wr_g:.1f}%",                 border=1, fill=True, align="C")
            pdf.set_text_color(*(_GREEN if gp_val >= 0 else _RED))
            pdf.cell(24, 5.5, _pnl_str(gp_val),               border=1, fill=True, align="C")
            pdf.set_text_color(*_DARK)
            pdf.cell(16, 5.5, f"{gpf:.2f}" if gpf else "N/A", border=1, fill=True, align="C")
            pdf.set_text_color(*_GREEN)
            pdf.cell(20, 5.5, _pnl_str(g["avg_win"]),         border=1, fill=True, align="C")
            pdf.set_text_color(*_RED)
            pdf.cell(20, 5.5, _pnl_str(g["avg_loss"]),        border=1, fill=True, align="C")
            pdf.set_text_color(*scol)
            pdf.set_font("Helvetica", style="B", size=7)
            pdf.cell(18, 5.5, f"{score:.0f} {slabel[:3]}",    border=1, fill=True, align="C")
            pdf.set_text_color(*delta_col)
            pdf.set_font("Helvetica", size=7)
            pdf.cell(18, 5.5, delta_str,                       border=1, fill=True, align="C")
            pdf.ln()
        pdf.ln(3)

        pdf.set_font("Helvetica", size=7); pdf.set_text_color(*_MUTED)
        pdf.cell(0, 5,
            "Score 0-100: Win Rate (35) · Profit Factor (25) · Volume (15) · TP Rate (15) · Streak (10)",
            ln=True)
        pdf.ln(2)

        if groups_bar_img:
            pdf.image(io.BytesIO(groups_bar_img), x=10, y=None, w=190)
            pdf.ln(2)
        if groups_pie_img:
            y_gpie = pdf.get_y() + 2
            pdf.image(io.BytesIO(groups_pie_img), x=55, y=y_gpie, w=100)
            pdf.set_y(y_gpie + 68)
            pdf.ln(2)

        best_score_g = max(groups, key=lambda g: _compute_group_score(g))
        best_pnl_g   = max(groups, key=lambda g: g["total_profit"])
        worst_pnl_g  = min(groups, key=lambda g: g["total_profit"])
        pdf.section_title("Channel Summary")
        gcx = 10.0
        for label, val, pos in [
            ("Highest Score",     f"{best_score_g['group_name'][:16]} ({_compute_group_score(best_score_g):.0f})", True),
            ("Best P&L Channel",  f"{best_pnl_g['group_name'][:16]} ({_pnl_str(best_pnl_g['total_profit'])})",    True),
            ("Worst P&L Channel", f"{worst_pnl_g['group_name'][:16]} ({_pnl_str(worst_pnl_g['total_profit'])})",  False),
            ("Most Active",       max(groups, key=lambda g: g["total_trades"])["group_name"][:22],                 None),
        ]:
            pdf.metric_card(label, val, pos, x=gcx, w=44.0)
            gcx += 44.0 + 2.5
        pdf.ln(16)

    # ── Page 5: Trade list ────────────────────────────────────────────────────
    if trades:
        pdf.add_page()
        pdf.section_title(f"Trade List ({len(trades)} trades)")

        t_cols = [
            ("Ticket",18),("Symbol",18),("Dir",10),("Lots",14),
            ("Entry",20),("Exit",20),("Profit",22),("Reason",16),("Duration",20),
        ]
        pdf.set_font("Helvetica", style="B", size=7)
        pdf.set_fill_color(*_NAVY); pdf.set_text_color(*_WHITE)
        for h, w in t_cols:
            pdf.cell(w, 6, h, border=1, fill=True, align="C")
        pdf.ln()

        for i, t in enumerate(trades):
            dur_str = ""
            try:
                ot = t.get("open_time") or ""
                ct = t.get("close_time") or ""
                if ot and ct:
                    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                        try:
                            from datetime import datetime as _dt
                            o = _dt.fromisoformat(ot.replace("Z", "+00:00"))
                            c = _dt.fromisoformat(ct.replace("Z", "+00:00"))
                            diff  = c - o
                            h_dur = int(diff.total_seconds() // 3600)
                            m_dur = int((diff.total_seconds() % 3600) // 60)
                            dur_str = f"{h_dur}h {m_dur}m"
                            break
                        except Exception:
                            continue
            except Exception:
                pass

            profit = t.get("profit") or 0.0
            pdf.set_fill_color(*(_LIGHT if i % 2 == 0 else _WHITE))
            pdf.set_font("Helvetica", size=7); pdf.set_text_color(*_DARK)
            pdf.cell(18, 5.5, str(t.get("ticket") or ""),         border=1, fill=True, align="C")
            pdf.cell(18, 5.5, str(t.get("symbol") or ""),         border=1, fill=True, align="C")
            direction = t.get("order_type") or ""
            pdf.set_text_color(*(_BLUE if "BUY" in direction.upper() else _RED))
            pdf.cell(10, 5.5, direction[:4],                       border=1, fill=True, align="C")
            pdf.set_text_color(*_DARK)
            pdf.cell(14, 5.5, f"{t.get('lots') or 0:.2f}",        border=1, fill=True, align="C")
            pdf.cell(20, 5.5, f"{t.get('entry_price') or 0:.5f}", border=1, fill=True, align="C")
            pdf.cell(20, 5.5, f"{t.get('close_price') or 0:.5f}", border=1, fill=True, align="C")
            pdf.set_text_color(*(_GREEN if profit >= 0 else _RED))
            pdf.cell(22, 5.5, _pnl_str(profit),                   border=1, fill=True, align="C")
            pdf.set_text_color(*_DARK)
            pdf.cell(16, 5.5, str(t.get("reason") or "—"),        border=1, fill=True, align="C")
            pdf.cell(20, 5.5, dur_str or "—",                      border=1, fill=True, align="C")
            pdf.ln()

    # ── Page 6: AI Analysis ───────────────────────────────────────────────────
    pdf.add_page()
    pdf.section_title("AI Analysis — Period Evaluation")
    pdf.set_font("Helvetica", size=9); pdf.set_text_color(*_DARK)
    if ai_text:
        pdf.multi_cell(0, 5.5, ai_text, align="J")
    else:
        pdf.set_text_color(*_MUTED)
        pdf.cell(0, 8, "AI analysis not available.", ln=True)

    pdf.ln(6)
    pdf.set_font("Helvetica", size=7); pdf.set_text_color(*_MUTED)
    pdf.cell(0, 5,
        "Report automatically generated by SignalFlow AI · For informational purposes only.",
        align="C", ln=True)

    return bytes(pdf.output())


# ── AI insight generator ──────────────────────────────────────────────────────

async def _generate_ai_insights(
    api_key: str,
    stats: dict,
    last_6: list[dict],
    benchmarks: dict,
    risk: dict,
    title: str,
    groups_stats: list[dict] | None = None,
    prev_groups_stats: list[dict] | None = None,
) -> str:
    try:
        from google import genai
        client = genai.Client(api_key=api_key)

        prev_profit = last_6[-2]["total_profit"] if len(last_6) >= 2 else None
        pf_label    = f"{stats.get('profit_factor'):.2f}" if stats.get("profit_factor") else "N/A"
        by_sym      = stats.get("by_symbol", [])
        tp_count    = stats.get("tp_count", 0)
        sl_count    = stats.get("sl_count", 0)
        man_count   = stats.get("manual_count", 0)
        tot_closed  = tp_count + sl_count + man_count or 1
        top_sym     = by_sym[:3] if by_sym else []
        worst_sym   = sorted(by_sym, key=lambda s: s["total_profit"])[:3]
        all_symbols = [s["symbol"] for s in by_sym]

        sym_text = "\n".join(
            f"  - {s['symbol']}: {s['total']} trades, WR {s['win_rate']:.1f}%, P&L {_pnl_str(s['total_profit'])}"
            for s in top_sym
        ) or "  No data"

        worst_sym_text = "\n".join(
            f"  - {s['symbol']}: {_pnl_str(s['total_profit'])}, avg {_pnl_str(s['avg_profit'])}"
            for s in worst_sym if s["total_profit"] < 0
        ) or "  None in loss"

        bm_text = (
            f"- Bitcoin (BTC): {_pct_str(benchmarks.get('btc'))}\n"
            f"- Gold: {_pct_str(benchmarks.get('gold'))}\n"
            f"- S&P 500: {_pct_str(benchmarks.get('sp500'))}\n"
            f"- NASDAQ: {_pct_str(benchmarks.get('nasdaq'))}\n"
            f"- EUR/USD: {_pct_str(benchmarks.get('eurusd'))}"
        )

        groups      = groups_stats or []
        prev_lookup = {g["group_id"]: g for g in (prev_groups_stats or [])}
        group_section = ""
        if groups:
            def _gpf(g: dict) -> str:
                return f"{g['profit_factor']:.2f}" if g["profit_factor"] else "N/A"
            def _score_delta(g: dict) -> str:
                s = _compute_group_score(g)
                prev_g = prev_lookup.get(g["group_id"])
                if prev_g is None:
                    return f"{s:.0f} (new)"
                delta = s - _compute_group_score(prev_g)
                return f"{s:.0f} ({'↑' if delta >= 0 else '↓'}{delta:+.1f} vs prev. period)"
            g_lines = "\n".join(
                f"  - {g['group_name']}: {g['total_trades']} trades, WR {g['win_rate']:.1f}%, "
                f"P&L {_pnl_str(g['total_profit'])}, PF {_gpf(g)}, Score {_score_delta(g)}"
                for g in groups
            )
            group_section = f"""
### Telegram channel data (score 0-100):
{g_lines}
"""

        canali_section_request = ""
        if groups:
            canali_section_request = """
## 5. TELEGRAM CHANNEL COMPARISON
Analyze performance per channel using score and P&L data. Which channel improved or declined the most vs the previous period? Which contributes the most to total P&L? Recommend whether to exclude or reduce exposure to channels with low or declining scores.
"""

        prompt = f"""You are a senior algorithmic trading analyst. Analyze the following performance data and write a professional report divided into exactly {"5" if groups else "4"} sections:

## 1. EXECUTIVE SUMMARY
Write 3-4 sentences summarizing the period directly. Start with the main result (P&L). Cite the most relevant benchmark for this portfolio type.

## 2. SYMBOL & BENCHMARK ANALYSIS
Analyze the best and worst performing symbols. Identify the primary portfolio type (forex, indices, crypto, commodities). Based on the traded symbols, specify WHICH of the available benchmarks are most relevant and explain why. Assess whether the trader is outperforming or underperforming those specific benchmarks.

## 3. RISK & MANAGEMENT EVALUATION
Analyze: max drawdown, Sharpe ratio, execution quality (TP vs SL vs manual closes), loss streaks. Is risk management adequate? Is there overtrading?

## 4. ACTION PLAN FOR NEXT PERIOD
List 3-4 concrete, specific actions (not generic). Base each recommendation on a specific data point from this report.
{canali_section_request}
---

### Period data ({title}):
- Trades: {stats.get('total_trades',0)} ({stats.get('wins',0)} wins / {stats.get('losses',0)} losses)
- Win rate: {stats.get('win_rate',0):.1f}%
- Net P&L: ${stats.get('total_profit',0):+.2f}
- Profit factor: {pf_label}
- Best trade: ${stats.get('best_trade',0):+.2f} | Worst: ${stats.get('worst_trade',0):+.2f}
- Avg win: ${stats.get('avg_win',0):+.2f} | Avg loss: ${stats.get('avg_loss',0):+.2f}
- Max consecutive losses: {stats.get('max_consecutive_losses',0)} | wins: {stats.get('max_consecutive_wins',0)}
- Active trading days: {stats.get('active_trading_days',0)}

### All traded symbols:
{', '.join(all_symbols) or 'None'}

### Top symbols by P&L:
{sym_text}

### Symbols in loss:
{worst_sym_text}

### Risk metrics:
- Max drawdown: ${risk.get('max_drawdown',0):.2f} ({risk.get('max_drawdown_pct',0):.1f}%)
- Sharpe (annualized): {f"{risk.get('sharpe_approx'):.2f}" if risk.get('sharpe_approx') else 'N/A'}
- Recovery factor: {f"{risk.get('recovery_factor'):.2f}" if risk.get('recovery_factor') else 'N/A'}
- Daily volatility: ${risk.get('volatility_daily',0):.2f}

### Execution quality:
- TP: {tp_count} ({round(tp_count/tot_closed*100)}%) | SL: {sl_count} ({round(sl_count/tot_closed*100)}%) | Manual: {man_count} ({round(man_count/tot_closed*100)}%)

### Available benchmarks (monthly return):
{bm_text}

### Previous period P&L: {f"${prev_profit:+.2f}" if prev_profit is not None else "N/A"}
{group_section}
Respond EXCLUSIVELY in English. Use concrete data in every section. Be specific and direct, not generic."""

        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
            ),
        )
        return (response.text or "").strip()
    except Exception as exc:
        logger.warning("AI insights generation failed: %s", exc)
        return ""


# ── Public entry point ────────────────────────────────────────────────────────

class MonthlyReportGenerator:
    """
    Generates monthly (or arbitrary-period) PDF report with charts,
    extended benchmarks, pie charts, symbol analysis, risk metrics,
    Telegram channel comparison, and structured AI analysis.
    """

    def __init__(self, gemini_api_key: str) -> None:
        self._api_key = gemini_api_key

    def _check_deps(self) -> None:
        if not (_MPL_OK and _PDF_OK):
            missing = (["matplotlib"] if not _MPL_OK else []) + (["fpdf2"] if not _PDF_OK else [])
            raise RuntimeError(
                f"Missing packages: {', '.join(missing)}. Run: pip install " + " ".join(missing)
            )

    async def generate(
        self,
        user_id: str,
        year: int,
        month: int,
        stats: dict,
        trades: list[dict],
        equity_curve: list[dict],
        last_6: list[dict],
        groups_stats: list[dict] | None = None,
        prev_groups_stats: list[dict] | None = None,
    ) -> bytes:
        self._check_deps()
        title = f"{_MONTH_EN[month - 1]} {year}"
        return await self._build(title, stats, trades, equity_curve, last_6, year, month,
                                 groups_stats=groups_stats, prev_groups_stats=prev_groups_stats)

    async def generate_for_period(
        self,
        user_id: str,
        days: int,
        stats: dict,
        trades: list[dict],
        equity_curve: list[dict],
        last_6: list[dict],
        groups_stats: list[dict] | None = None,
        prev_groups_stats: list[dict] | None = None,
    ) -> bytes:
        self._check_deps()
        now = datetime.now(timezone.utc)
        title = f"Last {days} days — as of {now.strftime('%d/%m/%Y')}"
        return await self._build(title, stats, trades, equity_curve, last_6,
                                 now.year, now.month,
                                 groups_stats=groups_stats, prev_groups_stats=prev_groups_stats)

    async def _build(
        self,
        title: str,
        stats: dict,
        trades: list[dict],
        equity_curve: list[dict],
        last_6: list[dict],
        year: int,
        month: int,
        *,
        groups_stats: list[dict] | None = None,
        prev_groups_stats: list[dict] | None = None,
    ) -> bytes:
        risk       = _compute_risk_metrics(equity_curve)
        benchmarks = await _fetch_all_benchmarks(year, month)
        ai_text    = await _generate_ai_insights(
            self._api_key, stats, last_6, benchmarks, risk, title,
            groups_stats=groups_stats,
            prev_groups_stats=prev_groups_stats,
        )

        loop         = asyncio.get_event_loop()
        by_symbol    = stats.get("by_symbol", [])
        tp_count     = stats.get("tp_count", 0)
        sl_count     = stats.get("sl_count", 0)
        man_count    = stats.get("manual_count", 0)

        equity_img       = await loop.run_in_executor(None, _equity_chart,             equity_curve)
        pnl_bar_img      = await loop.run_in_executor(None, _daily_pnl_chart,          equity_curve)
        monthly_img      = await loop.run_in_executor(None, _monthly_comparison_chart, last_6)
        symbol_img       = await loop.run_in_executor(None, _symbol_chart,             by_symbol)
        pie_symbols_img  = await loop.run_in_executor(None, _pie_symbols_chart,        by_symbol)
        pie_outcomes_img = await loop.run_in_executor(None, _pie_outcomes_chart,       tp_count, sl_count, man_count)
        groups_bar_img   = await loop.run_in_executor(None, _groups_bar_chart,         groups_stats or [])
        groups_pie_img   = await loop.run_in_executor(None, _groups_pie_chart,         groups_stats or [])

        fn = functools.partial(
            _build_pdf,
            title, stats, trades, last_6, benchmarks, risk, ai_text,
            equity_img, pnl_bar_img, monthly_img, symbol_img,
            groups_stats=groups_stats or [],
            prev_groups_stats=prev_groups_stats or [],
            pie_outcomes_img=pie_outcomes_img,
            pie_symbols_img=pie_symbols_img,
            groups_bar_img=groups_bar_img,
            groups_pie_img=groups_pie_img,
        )
        return await loop.run_in_executor(None, fn)
