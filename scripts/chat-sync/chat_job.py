#!/usr/bin/env python3
"""Independent Nymphelia chat queue. Default is a read-only plan; --run opts in.

No title/date matching, no changes to video sync, no automatic local cleanup.
Publishing requires --publish and an independently configured `ia` CLI.
Forward-only: --forward-state names the persisted cutoff and only entries proven to start at or after
it are queued; --allow-backfill is the explicit, loud opt-out and is never used by chat_auto.py.
Targets listed in chat-quarantine.json next to the mapping (ambiguous item/stem) are never queued, uploaded
or deployed, whatever their queue state, until an operator resolves them (see chat_auto.py). While any
unresolved record exists the deploy hook is withheld globally, because a site rebuild would publish every
sidecar on Archive, including the held ones; all needsDeploy flags are kept for the first run after resolution.
"""
import argparse
from contextlib import contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

import chat_sync
from chat_sync import (ChatSyncError, ValidationError, _stage, parse_json_bytes,
                       sidecar_paths, sync_chat, validate_sidecar, _is_finite)
from forward_only import ForwardOnlyError, is_forward, parse_utc, read_watermark

# The saved-VOD (vodsync) ASMR items of channel nymphelia. chat_auto.py passes the live list from the
# vodsync config with --allowed-item; this default only applies to direct chat_job.py use.
# NYMPHELIA-GAMING26 (nyaphelia, live-recorded) is deliberately not here.
ITEMS = frozenset({"NYMPHELIA-2026-ASMR-2", "NYMPHELIA-2026-ASMR"})
MAPPING_KEYS = {"twitchVodId", "iaItem", "videoFile", "offsetSeconds", "note", "earliestStartUtc"}
STATUSES = {"pending", "downloaded", "uploading", "uploaded"}
UPLOAD_WAIT_SECONDS = 86400
QUARANTINE_NAME = "chat-quarantine.json"
QUARANTINE_REQUIRED = {"iaItem", "stem", "twitchVodIds"}
QUARANTINE_OPTIONAL = {"detectedAt", "keepTwitchVodId", "resolvedAt"}


class VideoPending(ValidationError):
    """Archive has not exposed the exact video yet; waiting is not a failed attempt."""
    kind = "video_pending"


class JobBusy(ChatSyncError):
    kind = "busy"


def read_mapping(path, items=None):
    items = ITEMS if items is None else items
    data = parse_json_bytes(Path(path).read_bytes(), "mapping")
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("entries"), list):
        raise ValidationError("mapping requires version:1 and entries:[]")
    ids, targets, entries = set(), set(), []
    for entry in data["entries"]:
        if not isinstance(entry, dict):
            raise ValidationError("each mapping must be an object")
        if set(entry) - MAPPING_KEYS:
            raise ValidationError("mapping has unknown keys; only " + ", ".join(sorted(MAPPING_KEYS)) + " are allowed")
        if "note" in entry and not isinstance(entry["note"], str):
            raise ValidationError("mapping note must be a string")
        vod = entry.get("twitchVodId")
        if not isinstance(vod, str) or not re.fullmatch(r"[0-9]{1,20}", vod):
            raise ValidationError("mapping twitchVodId must be a numeric string")
        item = entry.get("iaItem")
        if item not in items:
            raise ValidationError("mapping iaItem must be an allowed Nymphelia item")
        start = entry.get("earliestStartUtc")
        if "earliestStartUtc" in entry:
            try:
                parse_utc(start)
            except ForwardOnlyError:
                raise ValidationError("mapping earliestStartUtc must be an ISO UTC time like 2026-10-22T06:00:00Z") from None
        if not isinstance(entry.get("videoFile"), str):
            raise ValidationError("mapping requires the exact videoFile")
        name, _, stem = sidecar_paths(entry["videoFile"], ".")
        offset = entry.get("offsetSeconds")
        if not _is_finite(offset):
            raise ValidationError("mapping requires an explicit finite offsetSeconds")
        if vod in ids or (item, stem) in targets:
            raise ValidationError("duplicate VOD or ambiguous sidecar target in mapping")
        ids.add(vod)
        targets.add((item, stem))
        row = {"twitchVodId": vod, "iaItem": item, "videoFile": name, "offsetSeconds": offset}
        if start is not None:
            row["earliestStartUtc"] = start
        entries.append(row)
    return entries


def forward_only(entries, state_path):
    """-> (entries allowed by the persisted cutoff, [excluded VOD ids]). Entries that do not prove
    a start at or after the cutoff (older, or no earliestStartUtc at all) are never queued."""
    watermark = read_watermark(state_path)
    kept, excluded = [], []
    for entry in entries:
        (kept if is_forward(entry.get("earliestStartUtc"), watermark) else excluded).append(entry)
    return kept, [e["twitchVodId"] for e in excluded]


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(state, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    staged = _stage(path.parent, path.name, data)
    try:
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


@contextmanager
def job_lock(path):
    """OS-owned lock: a crash releases it; never unlink another process's lock."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            if not os.fstat(handle.fileno()).st_size:   # never read: the holder's byte range is unreadable
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise JobBusy("another chat job run holds the lock") from None
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise JobBusy("another chat job run holds the lock") from None
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)


def mapping_lock_path(mapping):
    mapping = Path(mapping)
    return mapping.with_name(mapping.name + ".lock")


def quarantine_path(mapping):
    return Path(mapping).with_name(QUARANTINE_NAME)


def target_key(entry):
    return entry["iaItem"], sidecar_paths(entry["videoFile"], ".")[2]


def read_quarantine(path):
    """-> {(iaItem, stem): record}. A missing file means nothing is quarantined; anything unreadable
    or malformed raises, so no caller can publish while the quarantine state is in doubt."""
    path = Path(path)
    if not path.exists():
        return {}
    data = parse_json_bytes(path.read_bytes(), "quarantine")
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("targets"), list):
        raise ValidationError("quarantine requires version:1 and targets:[]")
    quarantine = {}
    for record in data["targets"]:
        if not isinstance(record, dict) or not QUARANTINE_REQUIRED <= set(record) <= QUARANTINE_REQUIRED | QUARANTINE_OPTIONAL:
            raise ValidationError("each quarantine target needs iaItem, stem and twitchVodIds, and only known keys")
        item, stem, ids = record["iaItem"], record["stem"], record["twitchVodIds"]
        if not all(isinstance(text, str) and text for text in (item, stem)):
            raise ValidationError("quarantine iaItem and stem must be non-empty strings")
        if (not isinstance(ids, list) or not ids or len(set(ids)) != len(ids)
                or not all(isinstance(vod, str) and re.fullmatch(r"[0-9]{1,20}", vod) for vod in ids)):
            raise ValidationError("quarantine twitchVodIds must be unique numeric strings")
        for field in ("detectedAt", "resolvedAt"):
            if field in record:
                try:
                    parse_utc(record[field])
                except ForwardOnlyError:
                    raise ValidationError(f"quarantine {field} must be an ISO UTC time") from None
        if "keepTwitchVodId" in record and record["keepTwitchVodId"] not in ids:
            raise ValidationError("quarantine keepTwitchVodId must be one of the target's twitchVodIds")
        if (item, stem) in quarantine:
            raise ValidationError("duplicate quarantine target")
        quarantine[(item, stem)] = record
    return quarantine


def save_quarantine(path, quarantine):
    save_state(Path(path), {"version": 1, "targets": [quarantine[key] for key in sorted(quarantine)]})


def is_held(entry, quarantine):
    """True while the entry's item/stem target is quarantined and the entry is not the operator's explicit keeper."""
    try:
        record = quarantine.get(target_key(entry))
    except (ChatSyncError, KeyError, TypeError):
        return bool(quarantine)
    return record is not None and record.get("keepTwitchVodId") != entry.get("twitchVodId")


def deploy_gated(quarantine):
    """True while any quarantine record is unresolved: no target may trigger the global website rebuild."""
    return any("keepTwitchVodId" not in record for record in quarantine.values())


def archive_files(item):
    request = urllib.request.Request(f"https://archive.org/metadata/{item}", headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    if not isinstance(data.get("files"), list):
        raise ValidationError("Archive metadata has no file list")
    return [f for f in data["files"] if isinstance(f, dict) and not f.get("deleted") and not f.get("old_version")]


def _size(entry):
    try:
        return int(entry.get("size", 0))
    except (TypeError, ValueError):
        return 0


def validate_video_pair(files, mapping):
    name = mapping["videoFile"]
    stem = name.rsplit(".", 1)[0]
    candidates = [f for f in files if isinstance(f.get("name"), str)
                  and re.search(r"\.(mp4|mkv|webm)$", f["name"], re.I)
                  and f["name"].rsplit(".", 1)[0] == stem]
    if not candidates:
        raise VideoPending("exact video is not published yet")
    if len(candidates) != 1 or candidates[0]["name"] != name or _size(candidates[0]) <= 0:
        raise ValidationError("exact archived video is absent or its sidecar stem is ambiguous")


def read_queued_sidecar(path):
    limit = chat_sync.MAX_SIDECAR_BYTES
    if path.stat().st_size > limit:
        raise ValidationError("queued sidecar is over the size limit; regenerate it before publishing")
    payload = path.read_bytes()
    if len(payload) > limit:
        raise ValidationError("queued sidecar is over the size limit; regenerate it before publishing")
    return payload


def publication(files, path, payload=None):
    """Only exact size AND MD5 acknowledge our bytes, not an older same-name file."""
    payload = path.read_bytes() if payload is None else payload
    digest = hashlib.md5(payload).hexdigest()
    hits = [f for f in files if f.get("name") == path.name]
    if len(hits) == 1 and _size(hits[0]) == len(payload) and hits[0].get("md5") == digest:
        return "confirmed"
    return "conflict" if hits else "absent"


def upload_sidecar(item, path, command="ia"):
    # Filename is already the exact sidecar name, so the CLI preserves the remote name.
    # Credentials belong to ia's own config/environment; never capture/print its output.
    result = subprocess.run([command, "upload", item, str(path), "--no-derive"],
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=300)
    if result.returncode:
        raise RuntimeError(f"Archive uploader exited {result.returncode}")


def advance(mapping, state, work_dir, download, metadata, upload, now, publish=False, save=None):
    """One resumable entry, with injectable boundaries for offline integration tests.

    `save` persists state; it is called before the upload so a crash mid-upload leaves
    "uploading" (wait and confirm) instead of "downloaded" (which would upload again).
    """
    identity = state.setdefault("mapping", mapping.copy())
    if identity != mapping:
        raise ValidationError("mapping changed for a queued VOD; review its state before continuing")
    status = state.setdefault("status", "pending")
    if status == "published":
        return
    if status not in STATUSES:
        raise ValidationError("unknown chat job status")
    directory = Path(work_dir) / mapping["twitchVodId"]
    _, path, _ = sidecar_paths(mapping["videoFile"], directory)
    if status == "pending":
        download(mapping, directory)
    if not path.is_file():
        raise ValidationError("queued sidecar is missing; restore it or reset this entry to pending")
    payload = read_queued_sidecar(path)
    doc = parse_json_bytes(payload, "queued sidecar")
    validate_sidecar(doc, mapping["twitchVodId"], mapping["videoFile"])
    if doc["offsetSeconds"] != mapping["offsetSeconds"]:
        raise ValidationError("queued sidecar offset differs from the explicit mapping")
    if not doc["messages"]:
        raise ValidationError("queued sidecar has no messages; refusing to queue an empty chat")
    if status == "pending":
        state.update(status="downloaded", attempts=0, nextAttemptAt=0)
    if not publish:
        return
    files = metadata(mapping["iaItem"])
    validate_video_pair(files, mapping)
    confirmation = publication(files, path, payload)
    if confirmation == "confirmed":
        state.update(status="published", publishedAt=now, attempts=0, nextAttemptAt=0, needsDeploy=True)
        state.pop("previousPublication", None)
    elif confirmation == "conflict":
        previous = state.get("previousPublication")
        hits = [f for f in files if f.get("name") == path.name]
        if (state["status"] in {"uploading", "uploaded"} and isinstance(previous, dict)
                and len(hits) == 1 and previous.get("md5") == hits[0].get("md5")
                and previous.get("size") == _size(hits[0])
                and now - state.get("uploadedAt", now) < UPLOAD_WAIT_SECONDS):
            return   # An explicitly recorded metadata upgrade is still queued behind its old bytes.
        raise ValidationError("a different same-name sidecar exists on Archive; refusing to overwrite it")
    elif state["status"] == "downloaded":
        state.update(status="uploading", uploadedAt=now)
        if save:
            save()
        # Any failure from here on (timeout, interrupt, non-zero exit) is uncertain: the Archive may
        # already have accepted the bytes. Stay "uploading" and let later runs confirm via metadata.
        # Only an operator may reset the entry to "downloaded" to upload again.
        upload(mapping["iaItem"], path)
        state.update(status="uploaded", attempts=0, nextAttemptAt=0)
    elif now - state.get("uploadedAt", now) >= UPLOAD_WAIT_SECONDS:
        raise ValidationError("upload is still unpublished after 24h; inspect the Archive task before retrying")


def notify_deploy(url):
    if not url.startswith("https://"):
        raise ValidationError("deploy hook must use HTTPS")
    request = urllib.request.Request(url, data=b"", method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError("deploy hook failed")


def run_queue(entries, work_dir, download, metadata, upload, *, publish=False, max_attempts=5,
              retry_after=3600, now=None, deploy=None, quarantine=None):
    now = time.time() if now is None else now
    quarantine = {} if quarantine is None else quarantine
    work_dir = Path(work_dir)
    state_path = work_dir / "chat-state.json"
    with job_lock(work_dir / "chat-job.lock"):
        state = parse_json_bytes(state_path.read_bytes(), "job state") if state_path.exists() else {"version": 1, "entries": {}}
        if not isinstance(state, dict) or state.get("version") != 1 or not isinstance(state.get("entries"), dict):
            raise ValidationError("invalid job state; refusing to replace it")
        if not all(isinstance(row, dict) for row in state["entries"].values()):
            raise ValidationError("invalid job state; refusing to replace it")
        for mapping in entries:
            vod = mapping["twitchVodId"]
            if is_held(mapping, quarantine):
                continue            # state stays as is, whatever it was (even uploading): no download, no Archive call
            row = state["entries"].setdefault(vod, {})
            if row.get("attempts", 0) >= max_attempts or row.get("nextAttemptAt", 0) > now:
                continue
            try:
                advance(mapping, row, work_dir, download, metadata, upload, now, publish,
                        save=lambda: save_state(state_path, state))
                row.pop("error", None)
                row.pop("waitingForVideo", None)
            except VideoPending:
                row.pop("error", None)
                row["waitingForVideo"] = True
                row["nextAttemptAt"] = now + retry_after
            except (ChatSyncError, OSError, ValueError, TypeError, KeyError, RuntimeError,
                    http.client.HTTPException, subprocess.SubprocessError) as exc:
                row["attempts"] = row.get("attempts", 0) + 1
                row["nextAttemptAt"] = now + retry_after
                # Do not persist raw uploader/API exceptions, which can contain credentials.
                row["error"] = {"kind": getattr(exc, "kind", type(exc).__name__)}
            save_state(state_path, state)
        pending_hook = [row for vod, row in state["entries"].items()
                        if row.get("status") == "published" and row.get("needsDeploy")
                        and not is_held({"twitchVodId": vod, **row.get("mapping", {})}, quarantine)]
        if not pending_hook and state.pop("deployError", None):
            save_state(state_path, state)
        if deploy and pending_hook and not deploy_gated(quarantine):
            try:
                deploy()
            except Exception:
                # Keep needsDeploy; next timer run retries without uploading/downloading again.
                state["deployError"] = "deploy hook failed; retry pending"
            else:
                for row in pending_hook:
                    row["needsDeploy"] = False
                state.pop("deployError", None)
            save_state(state_path, state)
        return state


def select_entries(args):
    """-> (entries to queue, excluded VOD ids, quarantine, held VOD ids). Quarantined targets are never queued."""
    entries = read_mapping(args.mapping, frozenset(args.allowed_item) if args.allowed_item else None)
    quarantine = read_quarantine(quarantine_path(args.mapping))
    held = [mapping["twitchVodId"] for mapping in entries if is_held(mapping, quarantine)]
    entries = [mapping for mapping in entries if mapping["twitchVodId"] not in held]
    excluded = []
    if args.forward_state:
        entries, excluded = forward_only(entries, args.forward_state)
    return entries, excluded, quarantine, held


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--downloader", default="TwitchDownloaderCLI")
    parser.add_argument("--ia-command", default="ia")
    parser.add_argument("--max-attempts", type=int, default=5)
    parser.add_argument("--retry-after", type=float, default=3600)
    parser.add_argument("--forward-state", help="persisted forward-only cutoff (written by chat_auto.py)")
    parser.add_argument("--allow-backfill", action="store_true",
                        help="queue every mapping entry regardless of date; never used by the automatic bridge")
    parser.add_argument("--allowed-item", action="append", help="allowed Archive item; repeatable (default: Nymphelia ASMR items)")
    parser.add_argument("--run", action="store_true", help="execute downloads and persist local queue state")
    parser.add_argument("--publish", action="store_true", help="also upload to Archive and confirm publication")
    parser.add_argument("--deploy-hook-env", help="environment variable containing a deploy hook; optional")
    args = parser.parse_args(argv)
    try:
        if bool(args.forward_state) == bool(args.allow_backfill):
            raise ValidationError("pass exactly one of --forward-state or --allow-backfill")
        if args.max_attempts < 1 or not _is_finite(args.retry_after) or args.retry_after <= 0:
            raise ValidationError("retry limits must be finite and positive")
        if (args.publish or args.deploy_hook_env) and not args.run:
            raise ValidationError("--publish and --deploy-hook-env require --run")
        if args.deploy_hook_env and not args.publish:
            raise ValidationError("--deploy-hook-env requires --publish")
        if not args.run:
            entries, excluded, quarantine, held = select_entries(args)
            print(json.dumps({"mode": "plan", "entries": entries, "excludedBeforeCutoff": excluded,
                              "quarantined": list(quarantine.values()), "heldMappings": held}, ensure_ascii=False))
            return 0
        hook = os.environ.get(args.deploy_hook_env) if args.deploy_hook_env else None
        if args.deploy_hook_env and not hook:
            raise ValidationError("requested deploy hook environment variable is missing")
        with job_lock(mapping_lock_path(args.mapping)):
            entries, excluded, quarantine, held = select_entries(args)
            state = run_queue(entries, args.work_dir,
                              lambda m, out: sync_chat(m["twitchVodId"], m["videoFile"], out,
                                                      offset_seconds=m["offsetSeconds"], downloader=[args.downloader],
                                                      require_messages=True),
                              archive_files, lambda item, path: upload_sidecar(item, path, args.ia_command),
                              publish=args.publish, max_attempts=args.max_attempts, retry_after=args.retry_after,
                              deploy=(lambda: notify_deploy(hook)) if hook and args.publish else None,
                              quarantine=quarantine)
        deploy_pending = any(row.get("needsDeploy") for row in state["entries"].values())
        gated = deploy_pending and deploy_gated(quarantine)
        print(json.dumps({"entries": {vod: {k: row[k] for k in ("status", "attempts", "error", "needsDeploy", "waitingForVideo") if k in row}
                                      for vod, row in state["entries"].items()},
                          "excludedBeforeCutoff": len(excluded), "quarantined": held,
                          "deployPending": deploy_pending, "deployGated": gated,
                          "warnings": ["deploy_gated_by_quarantine"] if gated else []}))
        return 1 if state.get("deployError") or any(row.get("error") for row in state["entries"].values()) else 0
    except JobBusy:
        print(json.dumps({"status": "busy"}))
        return 0
    except (ChatSyncError, OSError, ValueError) as exc:
        print(json.dumps({"status": "error", "kind": getattr(exc, "kind", type(exc).__name__)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
