
#!/usr/bin/env bash
# Small bench wrapper — runs the bench_ws.py in simulate mode to produce bench/metrics.json

PYTHON=${PYTHON:-python}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# parse args: --duration N --mode server|simulate
MODE="simulate"
DURATION=30
RATE=15
MSG_SIZE=4000
SIGNALING_URL="ws://localhost:8080"

while [[ "$#" -gt 0 ]]; do
	case "$1" in
		--mode)
			MODE="$2"; shift 2;;
		--duration)
			DURATION="$2"; shift 2;;
		--rate)
			RATE="$2"; shift 2;;
		--msg-size)
			MSG_SIZE="$2"; shift 2;;
		--signaling-url)
			SIGNALING_URL="$2"; shift 2;;
		*) echo "Unknown arg: $1"; exit 1;;
	esac
done

echo "Running bench mode=$MODE duration=${DURATION}s rate=${RATE}Hz msg_size=${MSG_SIZE}B"
if [[ "$MODE" == "server" ]]; then
	"$PYTHON" "$ROOT_DIR/bench/bench_server_mode.py" --duration "$DURATION" --rate "$RATE" --msg-size "$MSG_SIZE" --signaling-url "$SIGNALING_URL" --out "$ROOT_DIR/bench/metrics.json"
else
	"$PYTHON" "$ROOT_DIR/bench/bench_ws.py" --simulate --duration "$DURATION" --rate "$RATE" --msg-size "$MSG_SIZE" --out "$ROOT_DIR/bench/metrics.json"
fi

echo "Bench complete. Output: $ROOT_DIR/bench/metrics.json"

