"""
Monitoraggio continuo delle risorse VPS.

Ogni `interval` secondi campiona CPU, memoria, disco, rete e lista i
`top_n` processi più impattanti (score = cpu% + mem%), poi scrive tutto
su performance.log tramite il logger 'vps.services.vps_monitor'.

Uso:
    monitor = VpsMonitor(interval=60, top_n=5)
    monitor.start()           # avvio in lifespan FastAPI
    await monitor.stop()      # shutdown
    monitor.get_snapshot()    # ultimo campione (dict) per /health
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

import psutil

logger = logging.getLogger(__name__)

_KB = 1024
_MB = _KB * _KB
_GB = _MB * _KB


class VpsMonitor:
    def __init__(self, interval: int = 60, top_n: int = 5) -> None:
        self._interval = interval
        self._top_n = top_n
        self._task: asyncio.Task | None = None
        self._snapshot: dict[str, Any] | None = None

        # Priming: la prima chiamata a cpu_percent restituisce sempre 0;
        # il priming qui garantisce letture valide al primo campionamento.
        psutil.cpu_percent(percpu=True)
        for proc in psutil.process_iter():
            try:
                proc.cpu_percent(interval=None)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass

        # Baseline I/O per calcolo rate al primo intervallo
        self._prev_net: psutil._common.snetio | None = psutil.net_io_counters()
        self._prev_disk: psutil._common.sdiskio | None = psutil.disk_io_counters()
        self._prev_time: float = time.monotonic()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        self._task = asyncio.get_event_loop().create_task(self._run(), name="vps_monitor")
        logger.info(
            "VpsMonitor avviato (interval=%ds, top_n=%d)", self._interval, self._top_n
        )

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("VpsMonitor fermato")

    def get_snapshot(self) -> dict[str, Any] | None:
        """Restituisce l'ultimo campione raccolto (thread-safe in lettura)."""
        return self._snapshot

    # ── Loop principale ───────────────────────────────────────────────────────

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._interval)
                snapshot = await asyncio.to_thread(self._collect)
                self._snapshot = snapshot
                self._log_snapshot(snapshot)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("VpsMonitor: errore raccolta metriche: %s", exc, exc_info=True)

    # ── Raccolta metriche ────────────────────────────────────────────────────

    def _collect(self) -> dict[str, Any]:
        now = time.monotonic()
        elapsed = max(now - self._prev_time, 0.1)
        self._prev_time = now

        # ── CPU ───────────────────────────────────────────────────────────────
        per_core = psutil.cpu_percent(percpu=True)
        cpu_total = round(sum(per_core) / len(per_core), 1) if per_core else 0.0
        try:
            load_avg = [round(v, 2) for v in os.getloadavg()]
        except AttributeError:
            load_avg = None  # Windows non supporta getloadavg

        freq = psutil.cpu_freq()
        cpu_freq_mhz = round(freq.current) if freq else None

        # ── Memoria ───────────────────────────────────────────────────────────
        mem = psutil.virtual_memory()
        swap = psutil.swap_memory()

        # ── Disco: partizioni ─────────────────────────────────────────────────
        partitions: list[dict] = []
        for part in psutil.disk_partitions(all=False):
            try:
                usage = psutil.disk_usage(part.mountpoint)
                partitions.append({
                    "mountpoint": part.mountpoint,
                    "fstype":     part.fstype,
                    "used_pct":   round(usage.percent, 1),
                    "used_gb":    round(usage.used / _GB, 2),
                    "total_gb":   round(usage.total / _GB, 2),
                    "free_gb":    round(usage.free / _GB, 2),
                })
            except (PermissionError, OSError):
                pass

        # ── Disco: I/O rate ───────────────────────────────────────────────────
        disk_io = psutil.disk_io_counters()
        if disk_io and self._prev_disk:
            disk_read_kbs  = round((disk_io.read_bytes  - self._prev_disk.read_bytes)  / elapsed / _KB, 1)
            disk_write_kbs = round((disk_io.write_bytes - self._prev_disk.write_bytes) / elapsed / _KB, 1)
        else:
            disk_read_kbs = disk_write_kbs = 0.0
        self._prev_disk = disk_io

        # ── Rete ──────────────────────────────────────────────────────────────
        net_io = psutil.net_io_counters()
        if net_io and self._prev_net:
            net_sent_kbs = round((net_io.bytes_sent - self._prev_net.bytes_sent) / elapsed / _KB, 1)
            net_recv_kbs = round((net_io.bytes_recv - self._prev_net.bytes_recv) / elapsed / _KB, 1)
        else:
            net_sent_kbs = net_recv_kbs = 0.0
        self._prev_net = net_io

        try:
            conn_count = len(psutil.net_connections(kind="all"))
        except (psutil.AccessDenied, OSError):
            conn_count = -1

        # ── Uptime ────────────────────────────────────────────────────────────
        uptime_s = int(time.time() - psutil.boot_time())

        # ── Processi top-N ────────────────────────────────────────────────────
        procs: list[dict] = []
        mem_total = mem.total or 1
        for proc in psutil.process_iter(["pid", "name", "status", "memory_info"]):
            try:
                cpu_pct = proc.cpu_percent(interval=None)
                mem_info = proc.info.get("memory_info")
                rss = mem_info.rss if mem_info else 0
                mem_pct = round(rss / mem_total * 100, 2)
                score = round(cpu_pct + mem_pct, 2)
                procs.append({
                    "pid":       proc.info["pid"],
                    "name":      (proc.info["name"] or "?")[:40],
                    "status":    proc.info["status"] or "?",
                    "cpu_pct":   round(cpu_pct, 2),
                    "mem_pct":   mem_pct,
                    "mem_rss_mb": round(rss / _MB, 1),
                    "score":     score,
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass

        top_procs = sorted(procs, key=lambda p: p["score"], reverse=True)[: self._top_n]

        return {
            "cpu": {
                "total_pct":    cpu_total,
                "per_core_pct": [round(c, 1) for c in per_core],
                "freq_mhz":     cpu_freq_mhz,
                "load_avg":     load_avg,
            },
            "memory": {
                "used_pct":     round(mem.percent, 1),
                "used_gb":      round(mem.used / _GB, 2),
                "total_gb":     round(mem.total / _GB, 2),
                "available_gb": round(mem.available / _GB, 2),
                "swap_used_pct": round(swap.percent, 1),
                "swap_used_gb": round(swap.used / _GB, 2),
            },
            "disk": {
                "partitions":    partitions,
                "read_kbs":      disk_read_kbs,
                "write_kbs":     disk_write_kbs,
            },
            "network": {
                "sent_kbs":    net_sent_kbs,
                "recv_kbs":    net_recv_kbs,
                "connections": conn_count,
            },
            "uptime_s":      uptime_s,
            "top_processes": top_procs,
        }

    # ── Formattazione log ────────────────────────────────────────────────────

    def _log_snapshot(self, s: dict[str, Any]) -> None:
        SEP = "─" * 72

        logger.info(SEP)

        # CPU
        c = s["cpu"]
        cores_str = "  ".join(f"{v}%" for v in c["per_core_pct"])
        freq_str  = f"  freq={c['freq_mhz']}MHz" if c["freq_mhz"] else ""
        load_str  = ""
        if c["load_avg"]:
            load_str = "  load_avg(1/5/15)=[{}]".format(", ".join(str(v) for v in c["load_avg"]))
        logger.info("CPU     total=%s%%  cores=[%s]%s%s", c["total_pct"], cores_str, freq_str, load_str)

        # Memoria
        m = s["memory"]
        logger.info(
            "MEM     used=%s%%  %.2fGB/%.2fGB  avail=%.2fGB  swap=%s%% (%.2fGB)",
            m["used_pct"], m["used_gb"], m["total_gb"],
            m["available_gb"], m["swap_used_pct"], m["swap_used_gb"],
        )

        # Disco — partizioni
        for p in s["disk"]["partitions"]:
            logger.info(
                "DISK    %-22s  [%s]  used=%s%%  %.2fGB/%.2fGB  free=%.2fGB",
                p["mountpoint"], p["fstype"],
                p["used_pct"], p["used_gb"], p["total_gb"], p["free_gb"],
            )
        d = s["disk"]
        logger.info("DISK_IO read=%.1fKB/s  write=%.1fKB/s", d["read_kbs"], d["write_kbs"])

        # Rete
        n = s["network"]
        conn_str = str(n["connections"]) if n["connections"] >= 0 else "n/a"
        logger.info(
            "NET     sent=%.1fKB/s  recv=%.1fKB/s  conn=%s",
            n["sent_kbs"], n["recv_kbs"], conn_str,
        )

        # Uptime
        us = s["uptime_s"]
        days, rem = divmod(us, 86400)
        hours, rem = divmod(rem, 3600)
        mins = rem // 60
        logger.info("UPTIME  %dd %dh %02dm", days, hours, mins)

        # Top processi
        procs = s["top_processes"]
        if procs:
            logger.info(
                "TOP %d PROCESSI  (score = cpu%% + mem%%, mem rispetto a %.2fGB totali)",
                len(procs), s["memory"]["total_gb"],
            )
            for i, p in enumerate(procs, 1):
                logger.info(
                    "  #%d  %-35s  pid=%-6d  cpu=%5.1f%%  mem=%5.1f%% (%6.1fMB)  score=%6.1f  [%s]",
                    i, p["name"], p["pid"],
                    p["cpu_pct"], p["mem_pct"], p["mem_rss_mb"],
                    p["score"], p["status"],
                )
        logger.info(SEP)
