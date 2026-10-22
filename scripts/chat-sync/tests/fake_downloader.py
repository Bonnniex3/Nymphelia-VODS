"""Stand-in for TwitchDownloaderCLI used by the tests: `fake_downloader.py chatdownload --id X --output F`.

FAKE_MODE: ok (copy FAKE_SOURCE) | fail (exit 1, write nothing) | truncate (exit 0, half a file)
           | none (exit 0, no file) | hang (sleep) | argv (dump argv to FAKE_SOURCE-adjacent file)
"""
import os
import sys
import time
from pathlib import Path

args = sys.argv[1:]
output = Path(args[args.index("--output") + 1])
mode = os.environ.get("FAKE_MODE", "ok")
source = Path(os.environ.get("FAKE_SOURCE", ""))

if mode == "fail":
    print("boom: rate limited", file=sys.stderr)
    sys.exit(1)
if mode == "none":
    sys.exit(0)
if mode == "hang":
    time.sleep(60)
if mode == "truncate":
    data = source.read_bytes()
    output.write_bytes(data[: len(data) // 2])
    sys.exit(0)
if mode == "argv":
    Path(os.environ["FAKE_ARGV_OUT"]).write_text("\n".join(args), encoding="utf-8")
output.write_bytes(source.read_bytes())
