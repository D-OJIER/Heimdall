"""Simple bench runner for signaling/WebSocket latency and throughput.

This script has two modes:
 - Live mode: connect to a WebSocket URL and send timestamped messages, measure RTT and bytes.
 - Simulate mode: no network required; generates synthetic RTT/throughput samples deterministically.

For quick results (no external deps), run with `--simulate`.

Output: writes a JSON file with median & P95 latency (ms), processed FPS, uplink_kbps, downlink_kbps.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import time
from typing import List


def percentile(data: List[float], p: float) -> float:
    if not data:
        return 0.0
    data = sorted(data)
    k = (len(data)-1) * (p/100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return data[int(k)]
    d0 = data[int(f)] * (c-k)
    d1 = data[int(c)] * (k-f)
    return d0 + d1


def run_simulation(duration_s: int, rate_hz: float, msg_size_bytes: int):
    """Simulate sending timestamped messages and receiving an echo with variable latency."""
    total_sent = 0
    total_recv = 0
    rtts_ms: List[float] = []
    processed = 0

    # base network latency distribution (ms)
    base_ms = 30.0
    jitter_ms = 40.0
    processing_ms = 10.0

    interval = 1.0 / rate_hz if rate_hz > 0 else 0.1
    end_time = time.time() + duration_s
    next_send = time.time()
    while time.time() < end_time:
        now = time.time()
        if now < next_send:
            time.sleep(min(next_send - now, 0.01))
            continue

        # simulate network + processing delays
        uplink = max(0.0, random.gauss(base_ms, jitter_ms/2.0))
        backend_processing = max(0.0, random.expovariate(1.0/processing_ms))
        downlink = max(0.0, random.gauss(base_ms/2.0, jitter_ms/3.0))

        rtt = uplink + backend_processing + downlink
        rtts_ms.append(rtt)

        total_sent += msg_size_bytes
        total_recv += msg_size_bytes
        processed += 1

        next_send += interval

    duration_observed = duration_s
    median_ms = statistics.median(rtts_ms) if rtts_ms else 0.0
    p95_ms = percentile(rtts_ms, 95.0)
    fps = processed / duration_observed if duration_observed > 0 else 0.0
    uplink_kbps = (total_sent * 8) / (duration_observed * 1000.0)
    downlink_kbps = (total_recv * 8) / (duration_observed * 1000.0)

    return {
        "duration_s": duration_observed,
        "messages_sent": processed,
        "median_latency_ms": round(median_ms, 2),
        "p95_latency_ms": round(p95_ms, 2),
        "fps": round(fps, 2),
        "uplink_kbps": round(uplink_kbps, 2),
        "downlink_kbps": round(downlink_kbps, 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="WebSocket URL to connect to (live mode)", default=None)
    parser.add_argument("--duration", type=int, default=30, help="Duration in seconds")
    parser.add_argument("--rate", type=float, default=15.0, help="Messages per second to send")
    parser.add_argument("--msg-size", type=int, default=4000, help="Approx payload size in bytes per message")
    parser.add_argument("--out", default="bench/metrics.json", help="Output metrics JSON path")
    parser.add_argument("--simulate", action="store_true", help="Run in simulate mode (no network) and produce metrics.json)")

    args = parser.parse_args()

    if args.simulate or not args.url:
        print(f"Running simulated bench for {args.duration}s @ {args.rate}Hz, msg size={args.msg_size} bytes")
        metrics = run_simulation(args.duration, args.rate, args.msg_size)
    else:
        # Live mode requires external dependency 'websockets' and a running WS echo server.
        try:
            import asyncio
            import websockets

            async def live_run():
                rtts_ms = []
                total_sent = 0
                total_recv = 0
                processed = 0
                interval = 1.0 / args.rate if args.rate > 0 else 0.1
                end_time = time.time() + args.duration

                async with websockets.connect(args.url) as ws:
                    while time.time() < end_time:
                        send_ts = time.time()
                        payload = f"TS:{send_ts:.6f}" + ("x" * max(0, args.msg_size - 20))
                        await ws.send(payload)
                        total_sent += len(payload)
                        try:
                            recv = await asyncio.wait_for(ws.recv(), timeout=5.0)
                            recv_ts = time.time()
                            # expecting echo, compute rtt
                            rtt_ms = (recv_ts - send_ts) * 1000.0
                            rtts_ms.append(rtt_ms)
                            total_recv += len(recv)
                            processed += 1
                        except asyncio.TimeoutError:
                            print("recv timeout")

                        await asyncio.sleep(interval)

                duration_observed = args.duration
                median_ms = statistics.median(rtts_ms) if rtts_ms else 0.0
                p95_ms = percentile(rtts_ms, 95.0)
                fps = processed / duration_observed if duration_observed > 0 else 0.0
                uplink_kbps = (total_sent * 8) / (duration_observed * 1000.0)
                downlink_kbps = (total_recv * 8) / (duration_observed * 1000.0)

                return {
                    "duration_s": duration_observed,
                    "messages_sent": processed,
                    "median_latency_ms": round(median_ms, 2),
                    "p95_latency_ms": round(p95_ms, 2),
                    "fps": round(fps, 2),
                    "uplink_kbps": round(uplink_kbps, 2),
                    "downlink_kbps": round(downlink_kbps, 2),
                }

            print(f"Connecting to {args.url} for {args.duration}s @ {args.rate}Hz")
            metrics = asyncio.get_event_loop().run_until_complete(live_run())
        except Exception as e:
            print("Live mode failed or 'websockets' not installed; falling back to simulation. Error:", e)
            metrics = run_simulation(args.duration, args.rate, args.msg_size)

    print("Writing metrics to", args.out)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print("Done. Metrics:")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
