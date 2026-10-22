#!/usr/bin/env python3
"""Derive exact Nymphelia chat mappings from the vodsync journal, then run chat_job.py.

Default is a read-only plan. --run merges the mapping and runs the queue; --publish uploads
(needs --run); --deploy notifies the hook from the vodsync config (needs --publish).
Nothing is matched by title/date: a mapping needs all of VOD id, routed item and the exact
downloaded filename, seen in order within one systemd invocation and one channel/VOD context.
Forward-only: only VODs streamed on/after the persisted cutoff (see forward_only.py) are mapped.
A VOD whose local day straddles the cutoff is held until an optional exact `source published at` record
(logged between its VOD and route lines) qualifies it; without one it is excluded, never guessed.
Only the saved-VOD channel `nymphelia` is handled; the live-recorded `nyaphelia` is ignored.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading

from chat_job import (JobBusy, is_held, job_lock, mapping_lock_path, quarantine_path, read_mapping, read_quarantine,
                      save_quarantine, save_state, target_key)
from chat_sync import ChatSyncError, ValidationError, parse_json_bytes, sidecar_paths
from forward_only import (DEFAULT_NOT_BEFORE, ForwardOnlyError, format_utc, local_stamp, parse_utc,
                          resolve_watermark, stamp_day_utc)

CHANNEL = "nymphelia"
ROOT = "/opt/vodsync/chat-nymphelia"      # isolated from the existing Smizzles chat dir /opt/vodsync/chat
HOOK_ENV = "NYMPHELIA_CHAT_DEPLOY_HOOK"
MAX_JOURNAL_BYTES = 100 * 1024 * 1024
STAMP_RE = re.compile(r"[0-9]{2}:[0-9]{2}:[0-9]{2} [A-Z]+ ")   # vodsync log prefix, e.g. "07:11:07 INFO "
CHANNEL_RE = re.compile(r"=== (.+?) ===(?:  \(.*\))?")          # "=== nymphelia ===" (config key, not Twitch login)
VOD_RE = re.compile(r"  VOD ([0-9]{1,20})  \[([^\]]*)\].*")      # "  VOD 2857582133  [10-22-26] title"
SOURCE_PREFIX = "    source published at "                          # optional, see enable-exact-timestamps.py
SOURCE_RE = re.compile(r"    source published at ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)")
ROUTE_RE = re.compile(r"    routed to (\S+)(?: \(.*\))?")
DOWNLOAD_PREFIX = "    downloading + remuxing -> "


class JournalError(ChatSyncError):
    kind = "journal"


class ConflictError(ChatSyncError):
    kind = "conflict"


class Policy:
    """What may be mapped: one vodsync channel key, its allowed Archive items, and the cutoff.

    `tz` is the vodsync `timezone` (the `[MM-DD-YY]` stamp is a local date); `watermark` is the
    forward-only cutoff as an aware UTC datetime."""
    def __init__(self, items, tz, watermark, channel=CHANNEL):
        self.channel, self.items, self.tz, self.watermark = channel.casefold(), frozenset(items), tz, watermark


class _Context:
    """Parser state for one systemd invocation. vod/item are None whenever the context is unsafe."""
    def __init__(self):
        self.channel_ok = False
        self.reset_vod()

    def reset_vod(self, dead=False):
        # stamp/day_start: the VOD line's local-day proof; exact: the optional precise start;
        # pending: the cutoff falls inside that day, so only a valid `exact` may qualify the VOD.
        self.vod, self.stamp, self.day_start, self.exact, self.pending = None, None, None, None, False
        self.item, self.dead = None, dead


STAT_KEYS = ("records", "channelBlocks", "vods", "beforeCutoff", "badDate", "downloads", "unrouted", "foreignItem",
             "exactStarts", "ambiguousDay", "badTimestamp", "inconsistentDate")


def derive_entries(records, policy, stats=None):
    """records: iterable of journal JSON objects (dicts), or None for an unparseable line.

    Returns [mapping entry]; a VOD seen twice with different data raises ConflictError.
    `stats` (a dict) receives counters so an empty result can be told apart from a silent failure."""
    stats = {} if stats is None else stats
    stats.update(dict.fromkeys(STAT_KEYS, 0))
    contexts, found = {}, {}
    for record in records:
        stats["records"] += 1
        if record is None:           # truncated/garbled line: its invocation is unknown, so drop all contexts
            for ctx in contexts.values():
                ctx.reset_vod(dead=True)
            continue
        invocation = record.get("_SYSTEMD_INVOCATION_ID")
        if not isinstance(invocation, str) or not invocation:
            continue
        ctx = contexts.setdefault(invocation, _Context())
        message = record.get("MESSAGE")
        if not isinstance(message, str):     # null (oversized field) or byte array: cannot trust the context
            ctx.reset_vod(dead=True)
            continue
        stamp = STAMP_RE.match(message)
        message = message[stamp.end():] if stamp else message
        channel = CHANNEL_RE.fullmatch(message)
        if channel:
            ctx.channel_ok = channel.group(1).casefold() == policy.channel
            stats["channelBlocks"] += ctx.channel_ok
            ctx.reset_vod()
            continue
        if message.startswith("  VOD "):
            match = VOD_RE.fullmatch(message)
            ctx.reset_vod()
            if match and ctx.channel_ok:
                stats["vods"] += 1
                day = stamp_day_utc(match.group(2), policy.tz)
                if day is None:
                    stats["badDate"] += 1
                    ctx.dead = True
                elif day[1] <= policy.watermark:
                    stats["beforeCutoff"] += 1       # the whole local day is before the cutoff: never backfilled
                    ctx.dead = True
                else:
                    ctx.vod, ctx.stamp, ctx.day_start = match.group(1), match.group(2), format_utc(day[0])
                    ctx.pending = day[0] < policy.watermark      # cutoff inside this day: need the exact start
            else:
                ctx.dead = True
            continue
        if message.startswith(SOURCE_PREFIX):
            if ctx.dead:                    # a dead context is never revived by a timestamp
                continue
            exact = SOURCE_RE.fullmatch(message)
            try:
                moment = parse_utc(exact.group(1)) if exact else None
            except ForwardOnlyError:
                moment = None
            if ctx.vod is None or ctx.item is not None or ctx.exact is not None or moment is None:
                # no VOD, after the route, a duplicate, or malformed: the record cannot be trusted
                stats["badTimestamp"] += 1
                ctx.reset_vod(dead=True)
            elif local_stamp(moment, policy.tz) != ctx.stamp:
                stats["inconsistentDate"] += 1       # exact start disagrees with the stamp: fail safe
                ctx.reset_vod(dead=True)
            elif moment < policy.watermark:
                stats["beforeCutoff"] += 1           # same local day, but streamed before the cutoff
                ctx.reset_vod(dead=True)
            else:
                ctx.exact, ctx.pending = format_utc(moment), False
                stats["exactStarts"] += 1
            continue
        route = ROUTE_RE.fullmatch(message)
        if route:
            if ctx.pending and not ctx.dead:     # straddling day, no exact start: date alone proves nothing
                stats["ambiguousDay"] += 1
                ctx.reset_vod(dead=True)
            elif ctx.vod is None or ctx.dead or ctx.item is not None:   # no VOD, or a second route: ambiguous
                ctx.reset_vod(dead=True)
            elif route.group(1) in policy.items:
                ctx.item = route.group(1)
            else:
                stats["foreignItem"] += 1
                ctx.reset_vod(dead=True)
            continue
        if message.startswith(DOWNLOAD_PREFIX):
            name = message[len(DOWNLOAD_PREFIX):]
            if ctx.vod and not ctx.dead and ctx.pending:
                stats["ambiguousDay"] += 1
                ctx.reset_vod(dead=True)
            if ctx.vod and not ctx.dead:
                stats["downloads"] += 1
                stats["unrouted"] += ctx.item is None     # a forward VOD downloaded with no `routed to` line
            if ctx.vod and ctx.item and not ctx.dead and name.endswith(".mp4"):
                try:
                    name, _, _ = sidecar_paths(name, ".")
                except ValidationError:
                    name = None
                if name:
                    entry = {"twitchVodId": ctx.vod, "iaItem": ctx.item, "videoFile": name, "offsetSeconds": 0,
                             "earliestStartUtc": ctx.exact or ctx.day_start}
                    old = found.setdefault(ctx.vod, entry)
                    if (old["iaItem"], old["videoFile"]) != (entry["iaItem"], entry["videoFile"]):
                        raise ConflictError("the journal maps one VOD to different targets")
                    old["earliestStartUtc"] = max(old["earliestStartUtc"], entry["earliestStartUtc"])   # keep the exact one
            ctx.reset_vod(dead=True)     # one download per VOD; a repeat line needs a fresh VOD line
    return list(found.values())


def parse_journal(lines, policy, stats=None):
    def records():
        for line in lines:
            try:
                record = json.loads(line)
            except ValueError:
                yield None
            else:
                yield record if isinstance(record, dict) else None
    return derive_entries(records(), policy, stats)


def read_journal(journalctl, unit, since_days, timeout):
    """Bounded `journalctl -o json` read; fails (never truncates) on overflow, timeout or error."""
    command = [journalctl, "-u", unit, "-o", "json", "--no-pager", "--since", f"{since_days} days ago",
               "--output-fields=MESSAGE,_SYSTEMD_INVOCATION_ID"]
    try:
        proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        raise JournalError("journalctl could not be started") from None
    timed_out = threading.Event()
    timer = threading.Timer(timeout, lambda: (timed_out.set(), proc.kill()))
    timer.start()
    try:
        data = proc.stdout.read(MAX_JOURNAL_BYTES + 1)
        if len(data) > MAX_JOURNAL_BYTES:
            proc.kill()
            raise JournalError("journal output exceeds the size cap")
        code = proc.wait()
    finally:
        timer.cancel()
        proc.kill()
        proc.wait()
        proc.stdout.close()
    if timed_out.is_set():
        raise JournalError("journalctl timed out")
    if code:
        raise JournalError(f"journalctl exited {code}")
    return data.splitlines()


def merge_mapping(path, derived, items=None):
    """-> (document to write, [added entries]). Existing entries are kept verbatim."""
    path = Path(path)
    doc = parse_json_bytes(path.read_bytes(), "mapping") if path.exists() else {"version": 1, "entries": []}
    read_mapping_doc = read_mapping(path, items) if path.exists() else []
    by_id = {e["twitchVodId"]: e for e in read_mapping_doc}
    targets = {(e["iaItem"], sidecar_paths(e["videoFile"], ".")[2]): e["twitchVodId"] for e in read_mapping_doc}
    added = []
    for entry in derived:
        old = by_id.get(entry["twitchVodId"])
        target = (entry["iaItem"], sidecar_paths(entry["videoFile"], ".")[2])
        if old:
            if (old["iaItem"], old["videoFile"]) != (entry["iaItem"], entry["videoFile"]):
                raise ConflictError("a mapped VOD id has a different target in the journal")
            continue                    # keep the manual/previous entry (and its offset) untouched
        if target in targets:
            raise ConflictError("a journal target is already mapped to a different VOD id")
        by_id[entry["twitchVodId"]], targets[target] = entry, entry["twitchVodId"]
        added.append(entry)
    doc = dict(doc, entries=list(doc["entries"]) + added)
    return doc, added


def split_ambiguous_targets(entries, mapped=(), quarantine=None):
    """Quarantine every VOD sharing a filename, also against the stored mapping and the persisted
    quarantine; never pick one or block unrelated chat. Only an operator-resolved keeper passes a quarantined target."""
    quarantine = quarantine or {}
    targets = {}
    for entry in (*mapped, *entries):
        targets.setdefault(target_key(entry), set()).add(entry["twitchVodId"])
    safe, blocked = [], []
    for entry in entries:
        key = target_key(entry)
        record = quarantine.get(key)
        allowed = len(targets[key]) == 1 if record is None else record.get("keepTwitchVodId") == entry["twitchVodId"]
        (safe if allowed else blocked).append(entry)
    return safe, blocked


def record_collisions(quarantine, blocked, mapped, stamp):
    """-> the quarantine with every newly blocked target recorded. Records are only ever added to or
    explicitly resolved, never dropped because the journal stopped showing a colliding VOD."""
    updated = {key: dict(record) for key, record in quarantine.items()}
    for entry in blocked:
        key = target_key(entry)
        record = updated.get(key)
        if record is not None and "keepTwitchVodId" in record:
            continue
        if record is None:
            record = updated[key] = {"iaItem": key[0], "stem": key[1], "twitchVodIds": [], "detectedAt": stamp}
        ids = set(record["twitchVodIds"]) | {entry["twitchVodId"]}
        ids |= {other["twitchVodId"] for other in mapped if target_key(other) == key}
        record["twitchVodIds"] = sorted(ids)
    return updated


def reconcile(mapping, quarantine_file, derived, items, stamp, persist=False):
    """-> (document to write, [added entries], [blocked derived entries], quarantine before, quarantine after).

    With `persist` (the caller holds the mapping lock) the detected collisions are written before the
    mapping merge, so an unrelated merge ConflictError can never discard them. Without it nothing is written."""
    quarantine = read_quarantine(quarantine_file)
    mapped = read_mapping(mapping, items) if Path(mapping).exists() else []
    safe, blocked = split_ambiguous_targets(derived, mapped, quarantine)
    effective = record_collisions(quarantine, blocked, mapped, stamp)
    if persist:
        if effective != quarantine:
            save_quarantine(quarantine_file, effective)
        if blocked:
            save_state(Path(mapping).with_name("mapping-conflicts.json"), {"version": 1, "entries": blocked})
    doc, added = merge_mapping(mapping, safe, items)
    return doc, added, blocked, quarantine, effective


def resolve_quarantine(mapping, quarantine_file, items, item, video_file, keep_vod, stamp):
    """Explicit operator decision: the one VOD that may own a quarantined target. The record stays, so the
    losing VOD can never be admitted later, even after it ages out of the journal."""
    quarantine = read_quarantine(quarantine_file)
    key = (item, sidecar_paths(video_file, ".")[2])
    record = quarantine.get(key)
    if record is None or keep_vod not in record["twitchVodIds"]:
        raise ConflictError("that target is not quarantined for that VOD id")
    if any(target_key(entry) == key and entry["twitchVodId"] != keep_vod
           for entry in (read_mapping(mapping, items) if Path(mapping).exists() else [])):
        raise ConflictError("the mapping holds another VOD for that target; remove that entry first")
    quarantine[key] = dict(record, keepTwitchVodId=keep_vod, resolvedAt=stamp)
    save_quarantine(quarantine_file, quarantine)
    return quarantine[key]


def load_channel(config_path, channel=CHANNEL):
    """-> (allowed items, tzinfo, hook or None) from the vodsync config's `channels.<channel>`.

    Items are the channel's `collections` values; a channel that is live-recorded (vodrec) is refused,
    because its journal has no VOD id/route and it must never be matched by date or title."""
    data = parse_json_bytes(Path(config_path).read_bytes(), "config")
    channels = data.get("channels") if isinstance(data, dict) else None
    block = channels.get(channel) if isinstance(channels, dict) else None
    if not isinstance(block, dict):
        raise ValidationError(f"config has no channels.{channel}")
    if block.get("liveRecord"):
        raise ValidationError(f"channels.{channel} is live-recorded; saved-VOD chat mapping does not apply")
    collections = block.get("collections")
    items = {v for v in collections.values() if isinstance(v, str) and v} if isinstance(collections, dict) else set()
    if not items:
        raise ValidationError(f"config channels.{channel}.collections lists no Archive items")
    zone = data.get("timezone", "America/Mexico_City")      # vodsync default; the stamp is a local date in it
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(zone)
    except Exception:
        raise ValidationError("config timezone is unavailable; install tzdata") from None
    hook = block.get("vercelDeployHook")
    return items, tz, hook if isinstance(hook, str) and hook.startswith("https://") else None


def run_job(args, hook, items, forward_state):
    command = [sys.executable, str(Path(__file__).with_name("chat_job.py")),
               "--mapping", args.mapping, "--work-dir", args.work_dir, "--downloader", args.downloader,
               "--ia-command", args.ia_command, "--forward-state", str(forward_state)]
    for item in sorted(items):
        command += ["--allowed-item", item]
    command.append("--run")
    env = dict(os.environ)
    if args.publish:
        command.append("--publish")
    if hook:
        command += ["--deploy-hook-env", HOOK_ENV]
        env[HOOK_ENV] = hook        # in memory only; never printed or written
    return subprocess.run(command, env=env, stdin=subprocess.DEVNULL).returncode


def warnings_for(stats):
    """Conditions that would otherwise look like "nothing to do". Any of them makes --run exit 1."""
    found = []
    if not stats["channelBlocks"]:
        found.append("channel_not_seen")      # empty/rotated journal, wrong unit, or the channel was never synced
    if stats["unrouted"]:
        found.append("route_missing")         # a forward VOD was downloaded without a `routed to` line
    if stats["foreignItem"]:
        found.append("item_not_allowed")      # routed to an item that is not in the channel's collections
    if stats["badTimestamp"] or stats["inconsistentDate"]:
        found.append("timestamp_invalid")     # a `source published at` record is malformed, misplaced or contradicts the stamp
    return found


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", default=ROOT + "/mapping.json")
    parser.add_argument("--work-dir", default=ROOT + "/queue")
    parser.add_argument("--forward-state", help="persisted cutoff; default: forward-only.json next to --mapping")
    parser.add_argument("--not-before", default=DEFAULT_NOT_BEFORE,
                        help="UTC cutoff on the stream's local-date stamp; persisted on the first --run, may only be raised")
    parser.add_argument("--channel", default=CHANNEL, help="vodsync channel key (saved-VOD channels only)")
    parser.add_argument("--downloader", default="/opt/vodsync/chat/bin/TwitchDownloaderCLI")
    parser.add_argument("--ia-command", default="/opt/vodsync/venv/bin/ia")
    parser.add_argument("--config", default="/opt/vodsync/config.json")
    parser.add_argument("--unit", default="vodsync.service")
    parser.add_argument("--journalctl", default="journalctl")
    parser.add_argument("--since-days", type=int, default=14)
    parser.add_argument("--journal-timeout", type=float, default=120)
    parser.add_argument("--resolve-quarantine", nargs=2, metavar=("ITEM", "VIDEO_FILE"),
                        help="operator decision for a quarantined item + video file; needs --keep-vod, runs nothing else")
    parser.add_argument("--keep-vod", help="the one Twitch VOD id that may own the target given to --resolve-quarantine")
    parser.add_argument("--run", action="store_true", help="write the merged mapping and run chat_job.py")
    parser.add_argument("--publish", action="store_true", help="also upload to Archive (needs --run)")
    parser.add_argument("--deploy", action="store_true", help="notify the config's Nymphelia deploy hook (needs --publish)")
    args = parser.parse_args(argv)
    try:
        if (args.publish and not args.run) or (args.deploy and not args.publish):
            raise ValidationError("--publish requires --run and --deploy requires --publish")
        if not 1 <= args.since_days <= 30 or not 0 < args.journal_timeout <= 3600:
            raise ValidationError("journal window must be 1-30 days and the timeout 1-3600 s")
        mapping = Path(args.mapping)
        forward_state = Path(args.forward_state) if args.forward_state else mapping.with_name("forward-only.json")
        items, tz, hook = load_channel(args.config, args.channel)
        if args.deploy and not hook:
            raise ValidationError(f"config has no https channels.{args.channel}.vercelDeployHook")
        now = datetime.now(timezone.utc)

        def derive(persist):
            watermark, status = resolve_watermark(forward_state, args.not_before, now, persist)
            stats = {}
            lines = read_journal(args.journalctl, args.unit, args.since_days, args.journal_timeout)
            derived = parse_journal(lines, Policy(items, tz, watermark, args.channel), stats)
            report = {"notBefore": watermark.strftime("%Y-%m-%dT%H:%M:%SZ"),
                      "cutoffState": status, "journal": stats, "warnings": warnings_for(stats)}
            return derived, report

        quarantine_file = quarantine_path(mapping)
        stamp = format_utc(now)
        if args.resolve_quarantine:
            if args.run or args.publish or args.deploy or not args.keep_vod:
                raise ValidationError("--resolve-quarantine needs --keep-vod and cannot be combined with --run")
            try:
                with job_lock(mapping_lock_path(mapping)):
                    record = resolve_quarantine(mapping, quarantine_file, items, *args.resolve_quarantine,
                                                args.keep_vod, stamp)
            except JobBusy:
                print(json.dumps({"status": "busy"}))
                return 1
            print(json.dumps({"mode": "resolve", "resolved": record}, ensure_ascii=False))
            return 0
        if not args.run:
            derived, report = derive(False)
            doc, added, blocked, _, effective = reconcile(mapping, quarantine_file, derived, items, stamp)
            held = {entry["twitchVodId"] for entry in doc["entries"] if is_held(entry, effective)}
            print(json.dumps({"mode": "plan", "new": added, "total": len(doc["entries"]),
                              "quarantined": [effective[key] for key in sorted(effective)],
                              "heldMappings": sorted(held), **report}, ensure_ascii=False))
            return 0
        with job_lock(mapping_lock_path(mapping)):
            derived, report = derive(True)
            doc, added, blocked, before, effective = reconcile(mapping, quarantine_file, derived, items, stamp,
                                                               persist=True)
            if added or not mapping.exists():
                save_state(mapping, doc)
        open_targets = [record for record in effective.values() if "keepTwitchVodId" not in record]
        if open_targets:
            report["warnings"].append("target_quarantined")
        print(json.dumps({"mode": "run", "added": len(added), "total": len(doc["entries"]), "quarantined": len(open_targets),
                          **report}))
        sys.stdout.flush()
        code = run_job(args, hook if args.deploy else None, items, forward_state)
        return code or (1 if report["warnings"] else 0)
    except JobBusy:
        print(json.dumps({"status": "busy"}))
        return 0
    except (ChatSyncError, OSError, ValueError) as exc:
        print(json.dumps({"status": "error", "kind": getattr(exc, "kind", type(exc).__name__)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
