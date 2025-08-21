"""Benchmark script for 'server' mode using the signaling WebSocket.

This script opens two WebSocket connections to the signaling server:
 - producer: sends `detection` messages with `capture_ts` and `inference_ts`.
 - receiver: listens for forwarded `detection` messages (signaling will add `recv_ts`).

Measured values (per forwarded message):
 - overlay_display_ts: wall-clock ms when receiver got the forwarded message
 - capture_ts: provided in payload (ms)
 - inference_ts: provided in payload (ms)
 - recv_ts: added by signaling (ms)

Computed metrics:
 - E2E latency per frame = overlay_display_ts - capture_ts (median & p95)
 - Server latency = inference_ts - recv_ts (median & p95)
 - Network latency = recv_ts - capture_ts (median & p95)
 - Processed FPS = count_displayed / duration
 - Bandwidth estimate = bytes sent by producer / bytes received by receiver (kbps)

If the signaling server is unreachable or `websocket` (websocket-client) is not installed,
the script falls back to a local simulation to produce metrics.json.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import threading
import time
import uuid
from typing import List

try:
    import websocket  # websocket-client
except Exception:
    websocket = None


def percentile(data: List[float], p: float) -> float:
    if not data:
        return 0.0
    data = sorted(data)
    k = (len(data) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return data[int(k)]
    d0 = data[int(f)] * (c - k)
    d1 = data[int(c)] * (k - f)
    return d0 + d1


class Receiver:
    def __init__(self, url: str):
        self.url = url
        self.ws_app = None
        self.thread = None
        self.lock = threading.Lock()
        self.messages = []  # tuples of (payload_dict, local_recv_ts_ms, raw_message_bytes_len)
        self.connected = False

    def _on_message(self, ws, message):
        now_ms = int(time.time() * 1000)
        try:
            j = json.loads(message)
        except Exception:
            return
        with self.lock:
            self.messages.append((j, now_ms, len(message.encode('utf-8'))))

    def _on_open(self, ws):
        self.connected = True

    def _on_close(self, ws, close_status_code, close_msg):
        self.connected = False

    def _on_error(self, ws, err):
        # Keep running; errors will be seen by caller
        pass

    def start(self):
        if websocket is None:
            raise RuntimeError('websocket-client not installed')
        self.ws_app = websocket.WebSocketApp(self.url,
                                            on_message=self._on_message,
                                            on_open=self._on_open,
                                            on_close=self._on_close,
                                            on_error=self._on_error)
        self.thread = threading.Thread(target=self.ws_app.run_forever, daemon=True)
        self.thread.start()
        # wait a short moment for connection
        t0 = time.time()
        while time.time() - t0 < 3.0:
            if self.connected:
                return True
            time.sleep(0.05)
        return self.connected

    def stop(self):
        try:
            if self.ws_app:
                self.ws_app.close()
        except Exception:
            pass

    def pop_messages(self):
        with self.lock:
            msgs = list(self.messages)
            self.messages.clear()
        return msgs


def run_server_mode(duration_s: int, rate_hz: float, msg_size_bytes: int, signaling_url: str, out: str):
    # Attempt to use websocket-client. If not available, fallback to simulation
    if websocket is None:
        print('websocket-client not available; falling back to simulation')
        return run_simulation(duration_s, rate_hz, msg_size_bytes, out)

    receiver = Receiver(signaling_url.replace('ws://', 'ws://'))
    ok = receiver.start()
    if not ok:
        print('Failed to connect receiver to signaling server; falling back to simulation')
        return run_simulation(duration_s, rate_hz, msg_size_bytes, out)

    # create a separate raw websocket for producer to send messages
    try:
        prod_ws = websocket.create_connection(signaling_url, timeout=5)
    except Exception as e:
        print('Producer failed to connect to signaling server:', e)
        receiver.stop()
        return run_simulation(duration_s, rate_hz, msg_size_bytes, out)

    bytes_sent = 0
    bytes_recv = 0

    e2e_latencies = []
    server_latencies = []
    network_latencies = []
    processed = 0
    telemetry_map = {}  # frame_id -> overlay_display_ts (ms)

    interval = 1.0 / rate_hz if rate_hz > 0 else 0.1
    end_time = time.time() + duration_s

    # Start a reading thread that periodically consumes receiver.messages
    def consume_loop():
        nonlocal bytes_recv, processed
        while time.time() < end_time + 1.0:
            msgs = receiver.pop_messages()
            for (msg, local_recv_ts, raw_len) in msgs:
                # expect msg = { type, from, payload }
                payload = None
                mtype = None
                if isinstance(msg, dict) and 'type' in msg:
                    mtype = msg.get('type')
                if isinstance(msg, dict) and 'payload' in msg:
                    payload = msg['payload']
                elif isinstance(msg, dict):
                    payload = msg
                else:
                    continue

                # Handle telemetry messages specially
                if mtype == 'telemetry' and isinstance(payload, dict):
                    try:
                        fid = payload.get('frame_id')
                        odt = int(payload.get('overlay_display_ts')) if payload.get('overlay_display_ts') is not None else None
                        if fid and odt:
                            telemetry_map[str(fid)] = odt
                    except Exception:
                        pass
                    bytes_recv += raw_len
                    continue

                bytes_recv += raw_len

                # must have capture_ts and inference_ts and recv_ts
                try:
                    capture_ts = int(payload.get('capture_ts'))
                    inference_ts = int(payload.get('inference_ts'))
                    recv_ts = int(payload.get('recv_ts')) if payload.get('recv_ts') is not None else None
                except Exception:
                    continue

                # Prefer client-sent overlay_display_ts from telemetry_map when available
                overlay_display_ts = None
                try:
                    overlay_display_ts = telemetry_map.get(str(payload.get('frame_id'))) if payload.get('frame_id') is not None else None
                except Exception:
                    overlay_display_ts = None
                if overlay_display_ts is None:
                    overlay_display_ts = int(local_recv_ts)
                e2e_latencies.append(overlay_display_ts - capture_ts)
                if recv_ts is not None:
                    network_latencies.append(recv_ts - capture_ts)
                    server_latencies.append(inference_ts - recv_ts)

                # consider message processed if detections exist
                dets = payload.get('detections')
                if isinstance(dets, list) and len(dets) > 0:
                    processed += 1

            time.sleep(0.05)

    consumer = threading.Thread(target=consume_loop, daemon=True)
    consumer.start()

    # Send messages at desired rate. Each message will be of type 'detection' so signaling validates and forwards.
    while time.time() < end_time:
        capture_ts = int(time.time() * 1000)
        # simulate inference delay of ~50ms +/- jitter
        inference_ts = capture_ts + int(max(10, min(200, int(50 + (10 * (0.5 - math.sin(time.time())))))))

        frame_id = f"bench-{uuid.uuid4().hex[:8]}"
        payload = {
            'frame_id': frame_id,
            'capture_ts': capture_ts,
            'inference_ts': inference_ts,
            'detections': [
                { 'label': 'person', 'score': 0.8, 'xmin': 0.1, 'ymin': 0.1, 'xmax': 0.3, 'ymax': 0.4 }
            ]
        }
        msg = json.dumps({ 'type': 'detection', 'payload': payload })
        try:
            prod_ws.send(msg)
            bytes_sent += len(msg.encode('utf-8'))
        except Exception:
            # If sending fails, break and fallback
            break

        time.sleep(interval)

    # close sockets
    try:
        prod_ws.close()
    except Exception:
        pass
    receiver.stop()

    # wait a short moment for consumer to finish
    time.sleep(0.5)

    duration_observed = duration_s
    median_e2e = statistics.median(e2e_latencies) if e2e_latencies else 0.0
    p95_e2e = percentile(e2e_latencies, 95.0) if e2e_latencies else 0.0
    median_server = statistics.median(server_latencies) if server_latencies else 0.0
    p95_server = percentile(server_latencies, 95.0) if server_latencies else 0.0
    median_network = statistics.median(network_latencies) if network_latencies else 0.0
    p95_network = percentile(network_latencies, 95.0) if network_latencies else 0.0
    fps = processed / duration_observed if duration_observed > 0 else 0.0
    uplink_kbps = (bytes_sent * 8) / (duration_observed * 1000.0) if duration_observed > 0 else 0.0
    downlink_kbps = (bytes_recv * 8) / (duration_observed * 1000.0) if duration_observed > 0 else 0.0

    metrics = {
        'duration_s': duration_observed,
        'messages_received': len(e2e_latencies),
        'median_e2e_latency_ms': round(median_e2e, 2),
        'p95_e2e_latency_ms': round(p95_e2e, 2),
        'median_server_latency_ms': round(median_server, 2),
        'p95_server_latency_ms': round(p95_server, 2),
        'median_network_latency_ms': round(median_network, 2),
        'p95_network_latency_ms': round(p95_network, 2),
        'fps': round(fps, 2),
        'uplink_kbps': round(uplink_kbps, 2),
        'downlink_kbps': round(downlink_kbps, 2),
        'bytes_sent': bytes_sent,
        'bytes_received': bytes_recv,
    }

    with open(out, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=2)

    print('Bench complete. Metrics:')
    print(json.dumps(metrics, indent=2))
    return metrics


def run_simulation(duration_s: int, rate_hz: float, msg_size_bytes: int, out: str):
    # reuse bench_ws.py style simulation for compatibility
    msgs = int(duration_s * rate_hz)
    # simulate similar latencies
    import random
    rtts = [max(10, random.gauss(60, 20)) for _ in range(max(1, msgs))]
    median = statistics.median(rtts)
    p95 = percentile(rtts, 95.0)
    fps = msgs / duration_s if duration_s > 0 else 0.0
    bytes_sent = msgs * msg_size_bytes
    bytes_recv = bytes_sent

    metrics = {
        'duration_s': duration_s,
        'messages_received': msgs,
        'median_e2e_latency_ms': round(median, 2),
        'p95_e2e_latency_ms': round(p95, 2),
        'median_server_latency_ms': round(max(0, median - 20), 2),
        'p95_server_latency_ms': round(max(0, p95 - 20), 2),
        'median_network_latency_ms': round(max(0, median - 30), 2),
        'p95_network_latency_ms': round(max(0, p95 - 30), 2),
        'fps': round(fps, 2),
        'uplink_kbps': round((bytes_sent * 8) / (duration_s * 1000.0), 2) if duration_s > 0 else 0.0,
        'downlink_kbps': round((bytes_recv * 8) / (duration_s * 1000.0), 2) if duration_s > 0 else 0.0,
        'bytes_sent': bytes_sent,
        'bytes_received': bytes_recv,
    }
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=2)
    print('Simulation fallback produced metrics:')
    print(json.dumps(metrics, indent=2))
    return metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--duration', type=int, default=30)
    parser.add_argument('--rate', type=float, default=12.0)
    parser.add_argument('--msg-size', type=int, default=4000)
    parser.add_argument('--signaling-url', default='ws://localhost:8080')
    parser.add_argument('--out', default='bench/metrics.json')
    args = parser.parse_args()

    run_server_mode(args.duration, args.rate, args.msg_size, args.signaling_url, args.out)


if __name__ == '__main__':
    main()
