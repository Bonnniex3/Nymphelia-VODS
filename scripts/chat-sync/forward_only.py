"""Forward-only guard: Nymphelia chat is only fetched for VODs streamed on/after a cutoff.

The cutoff is compared with the *stream* time of the VOD (the `[MM-DD-YY]` stamp vodsync writes into
its `VOD <id>  [stamp] title` log line and into the video file name), never with the time a VOD is
archived or the time this tool runs. A years-old VOD that vodsync only gets around to archiving
tomorrow therefore stays excluded: an old/no-chat VOD is never read as a request to backfill.

The stamp is a local calendar date, so by itself it can only prove a whole day:
* the whole local day is at/after the cutoff -> the VOD qualifies (start = the day's first instant);
* the whole local day is before the cutoff -> it never qualifies;
* the cutoff falls inside the day -> the date alone proves nothing. Only an exact `source published at`
  record (the stream's real start, logged by an optionally patched vodsync) can qualify it, and only if
  it agrees with the stamp. Without one the VOD is excluded; it is never accepted on a guess.

The cutoff itself is a persisted watermark. It is created on the first --run from --not-before
(safe default DEFAULT_NOT_BEFORE), can be raised later, and can never be lowered: lowering it is
what would start a backfill.
"""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re

from chat_sync import ValidationError, _stage, parse_json_bytes

DEFAULT_NOT_BEFORE = "2026-10-22T04:00:00Z"      # 2026-10-21 22:00 America/Mexico_City
STAMP_RE = re.compile(r"([0-9]{2})-([0-9]{2})-([0-9]{2})")
UTC_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")


class ForwardOnlyError(ValidationError):
    kind = "forward_only"


def parse_utc(text):
    """Strict 'YYYY-MM-DDTHH:MM:SSZ' -> aware UTC datetime. Anything looser is refused."""
    if not isinstance(text, str) or not UTC_RE.fullmatch(text):
        raise ForwardOnlyError("cutoff must look like 2026-10-22T04:00:00Z (UTC, with the trailing Z)")
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise ForwardOnlyError("cutoff is not a real date/time") from None


def format_utc(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def stamp_day_utc(stamp, tz):
    """'10-22-26' (vodsync's local date stamp) -> (first instant, first instant of the next day) as aware
    UTC datetimes, else None. The end is wall-clock midnight of the next local day, DST included."""
    match = STAMP_RE.fullmatch(stamp) if isinstance(stamp, str) else None
    if not match:
        return None
    month, day, year = (int(part) for part in match.groups())
    try:
        start = datetime(2000 + year, month, day, tzinfo=tz)
        return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def stamp_earliest_utc(stamp, tz):
    """The ISO UTC start of the stamp's local day, else None."""
    day = stamp_day_utc(stamp, tz)
    return format_utc(day[0]) if day else None


def local_stamp(moment, tz):
    """The `[MM-DD-YY]` stamp vodsync writes for an instant (its own local_stamp)."""
    return moment.astimezone(tz).strftime("%m-%d-%y")


def is_forward(earliest_utc, watermark):
    """earliest_utc: ISO string (or None). Unknown/unparseable dates are never forward."""
    try:
        return parse_utc(earliest_utc) >= watermark
    except ForwardOnlyError:
        return False


def read_watermark(path):
    """The persisted cutoff. Missing or damaged state fails closed; it is never recreated here."""
    path = Path(path)
    if not path.is_file():
        raise ForwardOnlyError("forward-only state is missing; run chat_auto.py --run once to initialize it")
    data = parse_json_bytes(path.read_bytes(), "forward-only state")
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ForwardOnlyError("invalid forward-only state; refusing to replace it")
    return parse_utc(data.get("notBefore"))


def _write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = _stage(path.parent, path.name, (json.dumps(doc, indent=2) + "\n").encode("utf-8"))
    try:
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def resolve_watermark(path, requested, now, persist):
    """-> (effective watermark, status) where status is 'initialized', 'raised' or 'existing'.

    The effective cutoff is the persisted one; a request below it is refused (that would backfill)
    and a request above it raises it. Nothing is written unless `persist`."""
    path = Path(path)
    requested = parse_utc(requested) if isinstance(requested, str) else requested
    if not path.exists():
        if persist:
            stamp = format_utc(now)
            _write(path, {"version": 1, "notBefore": format_utc(requested), "initializedAt": stamp})
        return requested, "initialized"
    current = read_watermark(path)
    if requested < current:
        raise ForwardOnlyError("--not-before is earlier than the persisted cutoff; lowering it would backfill old VODs")
    if requested == current:
        return current, "existing"
    if persist:
        doc = parse_json_bytes(path.read_bytes(), "forward-only state")
        doc.update(notBefore=format_utc(requested), raisedAt=format_utc(now))
        _write(path, doc)
    return requested, "raised"
