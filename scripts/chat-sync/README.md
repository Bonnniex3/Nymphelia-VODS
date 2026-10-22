# chat-sync (Nymphelia chat replay sidecars)

Downloads a Twitch VOD's chat with a separately installed
[TwitchDownloaderCLI](https://github.com/lay295/TwitchDownloader) and writes a
`<exact video stem>.chat.json` sidecar next to the video in the same Internet Archive item.
Python 3.9+ standard library only (3.8 for the converter alone; `zoneinfo` needs 3.9 and `tzdata`).

> **Status: live.** Installed in `/opt/vodsync/chat-nymphelia`; `nymphelia-chat.timer` runs hourly. See [Deploying](#deploying-to-the-vm).
> The website side (`src/watch/chat/`, reads `<stem>.chat.json`) is deployed with the site.

The exact-start logging patch is also installed on the VM. Its backup is
`/opt/vodsync/vodsync.py.bak-exact-ts-20261022T042914Z`; the verified diff adds only the timestamp log line.
All 206 offline pipeline tests pass on the VM. No qualifying new VOD has arrived yet; seven historical
VODs were excluded without downloading or uploading chat.

**Scope: `nymphelia` only (saved Twitch VODs, mirrored by `vodsync.service`), and forward-only.**
Old VODs do not get chat and are never backfilled; see [Forward-only](#forward-only).
The gaming alt `nyaphelia` is live-recorded by `vodrec.service` and is **not** handled; see
[nyaphelia is separate](#nyaphelia-is-separate-and-not-matched).

| File | Role |
| ---- | ---- |
| `chat_sync.py` | One-VOD converter: TwitchDownloader JSON -> validated sidecar (unchanged from the Smizzles tooling) |
| `chat_job.py` | Explicit-mapping queue: download, validate, upload with `ia`, confirm on Archive, ping the deploy hook |
| `chat_auto.py` | Derives exact mappings from the `vodsync.service` journal, then runs `chat_job.py` |
| `forward_only.py` | The persisted cutoff and the stream-date proof |
| `enable-exact-timestamps.py` | Optional, guarded one-line patch for the VM's `vodsync.py` (logs each VOD's exact start); never run automatically |
| `systemd/nymphelia-chat.{service,timer}` | Hourly oneshot, own unit names |
| `mapping.example.json` | Empty mapping |
| `tests/` | Offline tests (no network, `ia`, journal, downloader or VM) |

## Forward-only

The cutoff is the **stream's own start**, not the time a VOD is archived or the time this tool runs.
vodsync writes `  VOD <id>  [MM-DD-YY] title` (a *local* calendar date in the config's `timezone`,
`America/Mexico_City` by default) just before it downloads a VOD. A date can only prove a whole day, so a
VOD's local day is classified against the cutoff (default `2026-10-22T04:00:00Z`, i.e. 2026-10-21 22:00 local):

| the local day of the stamp is... | result |
| --- | --- |
| entirely at/after the cutoff (`10-22-26` and later) | qualifies; `earliestStartUtc` = that day's first instant |
| entirely before the cutoff (`10-20-26` and earlier) | never qualifies, whatever any later log line says |
| the day the cutoff falls in (`10-21-26`) | **held** until an exact start arrives; without one it is excluded (`ambiguousDay`), never guessed |

* An **old VOD that vodsync only archives tomorrow still has an old stamp**, so it stays excluded. A VOD
  with no chat is never read as a request to backfill.
* Unparseable stamps (`10/22/26`, `13-45-26`, empty) are never forward.
* **Exact start (optional).** With `enable-exact-timestamps.py` applied, vodsync logs
  `    source published at 2026-10-22T04:30:00Z` (UTC, from Twitch's `published` time, the same value its
  `[MM-DD-YY]` stamp is derived from) between the VOD line and the route line. The parser keeps the
  channel/VOD context pending until the route/download, so a stream that began at 22:30 local on 10-21 qualifies
  (`earliestStartUtc` = the exact start) while one that began at 21:59:59 does not. The record must:
  1. follow its own VOD line and precede the route (anything else is `badTimestamp`);
  2. appear once (a duplicate kills the context);
  3. match `YYYY-MM-DDTHH:MM:SSZ` exactly;
  4. fall on the same local day as the stamp (else `inconsistentDate`);
  5. be at/after the cutoff to qualify (inclusive).

  A bad record kills that context; it never revives a dead one (other channel, other invocation, garbled
  line, whole-day-before-cutoff, foreign item), and one VOD's record never carries to the next VOD. Logs
  without the record (an unpatched vodsync, or older runs in the 14-day window) keep working for whole later
  days exactly as before; only the cutoff's own local day needs the record.

The cutoff is a **persisted watermark**: `forward-only.json` next to the mapping. The first
`chat_auto.py --run` creates it from `--not-before` (safe default above); later runs read it back.
`--not-before` may **raise** the watermark but a lower value is refused (`{"status":"error","kind":"forward_only"}`),
because lowering it is exactly what would start a backfill. A missing or damaged file fails closed in
`chat_job.py`, which never creates one. A plan (`chat_auto.py` without `--run`) writes nothing.

Defence in depth, so the *queue* itself cannot contain old entries:

1. `chat_auto.py` drops pre-cutoff VODs while parsing the journal (`beforeCutoff`, `ambiguousDay`).
2. Every mapping entry it writes carries `earliestStartUtc` (the exact start when logged, else the local
   day's first instant); `chat_job.py --forward-state` re-reads the
   watermark and **skips** any entry that is older or has no `earliestStartUtc` (hand-added or legacy
   entries included), reporting `excludedBeforeCutoff`. The bridge always passes `--forward-state`;
   running `chat_job.py` directly requires either it or the loud `--allow-backfill`.

## Automatic mapping from the vodsync journal

The remote `synced-vods.json` only has `id -> status`, so exact mappings come from the
`vodsync.service` journal (`journalctl -u vodsync.service -o json --no-pager --since "14 days ago"`,
120 s timeout, fails on >100 MB). Per systemd invocation (`_SYSTEMD_INVOCATION_ID`) the parser needs,
in order, after dropping the `HH:MM:SS LEVEL ` prefix:

```
=== nymphelia ===                           resets everything; only the config key `nymphelia` counts
  VOD <id>  [MM-DD-YY] title                sets the VOD id and proves the stream date (forward-only)
    source published at <UTC ISO>Z          optional exact start (enable-exact-timestamps.py), once, before the route
    routed to <NYMPHELIA-2026-ASMR-2|...>   the Archive item vodsync actually uploads to
    downloading + remuxing -> <exact>.mp4   -> {id, item, videoFile, offsetSeconds: 0, earliestStartUtc}
```

`offsetSeconds` is 0 because the archived file is an untrimmed `-c copy` of the VOD. All of VOD id,
routed item and file name must be seen for the same VOD in the same invocation; a new channel/VOD line,
a repeated route or download, a foreign item, a null/binary/garbled record or a bad file name discards the
context (no stale route reuse). **The item is never guessed** from the config's current
`defaultItemId`, from file names or from dates: it comes from the `routed to` line only. The routed item
must be one of the channel's `collections` values in `/opt/vodsync/config.json` (currently
`NYMPHELIA-2026-ASMR-2` and `NYMPHELIA-2026-ASMR`); anything else, such as `NYMPHELIA-GAMING26`, is ignored.

The verified VM's `vodsync.py` emits the `routed to` line. The tool does not assume that silently; the
output carries `journal` counters and `warnings`, and `--run` exits **1** on any warning (the timer unit then
shows as failed instead of a quiet empty plan):

| warning | meaning |
| ------- | ------- |
| `channel_not_seen` | no `=== nymphelia ===` block in the window (empty/rotated journal, wrong unit, or vodsync not running) |
| `route_missing` | a forward-eligible VOD was downloaded with no `routed to` line, so it cannot be mapped |
| `item_not_allowed` | a forward-eligible VOD was routed to an item that is not in the channel's `collections` |
| `timestamp_invalid` | a `source published at` record was malformed, misplaced, duplicated or contradicted the stamp |

`journal.ambiguousDay` counts VODs on the cutoff's own local day that had no exact start and were excluded.
It is information, not a warning: legitimate pre-cutoff streams of that day land there too. For a
new stream on that day you expect to be mapped, a non-zero count means the patched vodsync is not running yet.
`journal.exactStarts` shows how many records were accepted.

Expected plan output (`notBefore`, `cutoffState` is `initialized` until the first `--run`):

```json
{"mode": "plan", "new": [], "total": 0, "quarantined": [], "heldMappings": [], "notBefore": "2026-10-22T04:00:00Z",
 "cutoffState": "initialized", "journal": {"records": 1234, "channelBlocks": 4, "vods": 7, "beforeCutoff": 7,
 "badDate": 0, "downloads": 0, "unrouted": 0, "foreignItem": 0, "exactStarts": 0, "ambiguousDay": 0,
 "badTimestamp": 0, "inconsistentDate": 0}, "warnings": []}
```

Until the first VOD streamed on/after the cutoff is archived, `new` is empty and `beforeCutoff` shows the
skipped old VODs; that is the correct, non-silent, "nothing new yet" result.

The result is merged into the persisted mapping under `<mapping>.lock` and written atomically.
Existing entries (including manual ones) are kept verbatim; the same id with the same item+file is a
no-op; an id with another target, or a target (item + sidecar stem) used by another id, aborts with
`{"status":"error","kind":"conflict"}` and writes nothing. Distinct Twitch VODs with an identical item and
video stem are quarantined (see [Ambiguous targets](#ambiguous-targets-quarantine)); other mappings continue.
`mapping-conflicts.json` is only an informational copy of the last run's blocked journal entries; nothing reads it.

### Ambiguous targets (quarantine)

Two different Twitch VOD ids that resolve to the same Archive item + sidecar stem would write the same
`<stem>.chat.json`, and nothing can say which VOD's chat belongs to the video. Such a target is quarantined
durably in `chat-quarantine.json` next to the mapping (`/opt/vodsync/chat-nymphelia/chat-quarantine.json`):

```json
{"version": 1, "targets": [{"iaItem": "NYMPHELIA-2026-ASMR-2", "stem": "[10-22-26] nymphelia - a stream",
  "twitchVodIds": ["2500000001", "2500000002"], "detectedAt": "2026-10-22T05:00:00Z"}]}
```

* **Detected** by `chat_auto.py` against the journal *and* the stored mapping (a stored VOD A plus a derived A/B,
  or a stored A plus a lone derived B, are both collisions). `--run` persists the detected records under the
  mapping lock *before* the mapping merge, so an unrelated mapping conflict in the same run (for example a stored
  C with another file than the journal's C, which aborts with `kind: conflict`) cannot discard them; the plan
  (no `--run`) computes the same result but writes nothing.
* **Persistent.** A record is only added to, never dropped because a VOD aged out of the 14-day journal window.
  A lone surviving VOD of a quarantined target is therefore never admitted to the mapping.
* **Enforced in `chat_job.py`**, so a direct run is covered too (`chat_auto.py` passes nothing extra). Every
  mapping entry on a quarantined target is skipped whatever its queue state (`pending`, `downloaded`,
  `uploading`, `uploaded`): no download, no Archive call, no upload, no confirmation, and its queue row is left
  untouched. Files already on Archive are never deleted or changed.
* **Global deploy gate.** The deploy hook rebuilds the whole website, and the build reads every sidecar on
  Archive, including those of held targets (the build has no quarantine information). So while *any* unresolved
  record exists (no `keepTwitchVodId`), `chat_job.py` does not call the hook at all, even when only an unrelated
  target is `published` with `needsDeploy`. Every `needsDeploy` flag is kept, `chat_job.py` run output reports
  `deployPending: true`, `deployGated: true` and `warnings: ["deploy_gated_by_quarantine"]`, and `chat_auto.py`
  exits 1 with `target_quarantined`. After `--resolve-quarantine` the next run calls the hook once and clears the
  flags of every published, non-held target. Held rows keep theirs; the remote files are never deleted.
* **Fails closed.** A malformed or unreadable `chat-quarantine.json` (bad JSON, unknown keys, duplicate targets,
  non-numeric ids, a directory in its place) aborts both tools with `{"status":"error"}` before any change;
  a missing file simply means nothing is quarantined. A queue row without a mapping is never counted for the
  hook while any quarantine record exists.
* **Loud.** `chat_auto.py --run` still processes unrelated mappings but exits 1 with the warning
  `target_quarantined` for as long as an unresolved record exists. The plan lists every effective block
  (persisted plus newly detected) under `quarantined`, and `heldMappings` lists stored VOD ids that are held;
  `chat_job.py` plan and run output show the same (`quarantined`, `heldMappings`).
* **Locking.** `chat_auto.py --run`, `--resolve-quarantine` and the whole of a `chat_job.py --run` hold
  `<mapping>.lock`, so the mapping/quarantine cannot change while a job is uploading; `chat_job.py` additionally
  holds `chat-job.lock`. A second run reports `{"status":"busy"}`.

**Resolving (explicit, operator only).** Decide which VOD owns the target, then:

```
python3 chat_auto.py --resolve-quarantine NYMPHELIA-2026-ASMR-2 "[10-22-26] nymphelia - a stream.mp4" --keep-vod 2500000001
```

This only adds `keepTwitchVodId` and `resolvedAt` to the record (nothing else runs; no journal is read). The keeper
is then processed normally; every other VOD id on that target stays blocked for good, even if it shows up in the
journal again. It refuses when the target is not quarantined, when `--keep-vod` is not one of the record's ids, or
when the mapping already holds a different VOD on that target (remove that entry by hand first). Reviewing the
Archive and the queue row for the keeper before resolving is on the operator. Deleting a record by hand is a
release, not a decision: the next `chat_auto.py --run` re-quarantines the target while both VODs are still in the
journal. Do not edit the file while a run is active.

```
python3 chat_auto.py                            # plan: prints new entries + diagnostics, writes/starts nothing
python3 chat_auto.py --run                      # init/read watermark, merge mapping, chat_job.py --run (download + validate)
python3 chat_auto.py --run --publish            # also upload to Archive
python3 chat_auto.py --run --publish --deploy   # also ping channels.nymphelia.vercelDeployHook
```

Defaults (all overridable): `--mapping /opt/vodsync/chat-nymphelia/mapping.json`, `--work-dir
/opt/vodsync/chat-nymphelia/queue`, `--forward-state` = `forward-only.json` next to the mapping,
`--not-before 2026-10-22T04:00:00Z`, `--channel nymphelia`, `--downloader
/opt/vodsync/chat/bin/TwitchDownloaderCLI` (shared binary, read only), `--ia-command
/opt/vodsync/venv/bin/ia`, `--config /opt/vodsync/config.json`, `--unit vodsync.service`, `--since-days 14`.
`--deploy` reads `channels.nymphelia.vercelDeployHook` and passes it to `chat_job.py` only through the
in-memory environment variable `NYMPHELIA_CHAT_DEPLOY_HOOK` (never argv, files or output); it requires
`--publish`. A `liveRecord` channel config is refused. The tool does not check that the video already exists
on Archive before downloading; `chat_job.py` does that and waits for a still-absent video without using up
attempts.

## nyaphelia is separate and not matched

`nyaphelia` is `liveRecord: true`: `vodrec.service` captures the live stream and uploads the file; it
never lists or downloads a saved Twitch VOD (they are DMCA-muted, which is the reason for live capture).
Its journal has no Twitch VOD id and no `routed to` line, and `vodsync` never prints a `=== nyaphelia ===`
block. Linking its chat would mean guessing a Twitch VOD id from a date or title, which this pipeline
refuses to do. Therefore: a `nyaphelia` block is ignored, `NYMPHELIA-GAMING26` is not an allowed item, and
`--channel nyaphelia` is rejected. Supporting it needs a separate capture-side design (for example
`vodrec` recording the Twitch VOD id at the moment it goes live), not a date/title match.

## Safety rules (unchanged from the Smizzles tooling)

Output is written only if all of these hold, otherwise the previous good sidecar is untouched and no temp
files are left behind:

1. the downloader exited 0 and wrote a non-empty file (or the `--normalize-only` file was readable);
2. the file is complete JSON (truncated/gzip-corrupt/`NaN` rejected) with `video` and `comments`;
3. the VOD id in the file (`video.id` and every `content_id`) equals `--vod-id`; a file with no id is refused;
4. every message has an id, a finite offset >= 0 and a body;
5. the built sidecar passes the strict schema check, is serialized, re-read and re-validated, then moved into
   place with `os.replace`.

Queue guarantees (`chat_job.py`): OS-owned lock; a single crash-safe upload (`uploading` is persisted before
`ia upload`, and an uncertain upload is only confirmed, never repeated); publication confirmed by exact size
**and** MD5; a different same-name sidecar on Archive is never overwritten; attempt cap with backoff; empty
chat is not queued; a cached sidecar over `chat_sync.MAX_SIDECAR_BYTES` is refused (size checked before it is read)
before parsing, Archive lookup or upload; quarantined targets are never touched; the deploy hook fires once per published batch (and not at all while any quarantine record is unresolved), is retried after failure, and no secret
reaches state or output.

## Converter usage

```
python chat_sync.py --vod-id 2500000001 \
    --video-file "[10-22-26] nymphelia - Some stream.mp4" \
    --output-dir ./chat [--downloader /path/to/TwitchDownloaderCLI] \
    [--offset-seconds 0] [--timeout 1800] [--keep-raw-dir ./raw]

# no binary needed: normalize an already downloaded file (.json or .json.gz)
python chat_sync.py --vod-id 2500000001 --video-file "x.mp4" --output-dir ./chat --normalize-only downloaded.json
```

Sidecar format:

```json
{"version": 1, "twitchVodId": "2500000001", "videoFile": "name.mp4", "offsetSeconds": 0,
 "messages": [{"id": "…", "offsetSeconds": 5.25, "user": "Al", "text": "Kappa hi",
               "fragments": [{"text": "Kappa", "emoteUrl": "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0"},
                             {"text": " hi"}]}]}
```

`--video-file` is an explicit exact basename (`.mp4 .mkv .webm`); the VOD-id -> video mapping is never guessed.
Exit codes: `0` ok/empty, `3` invalid data, `4` downloader missing/failed/timed out, `5` could not write, `2` bad
arguments. Message offsets stay as Twitch gave them; third-party (BTTV/FFZ/7TV) emotes are not resolved.

## Tests

```
python -B -I -m unittest discover -s scripts/chat-sync/tests
```

All offline. `test_forward_only.py` covers the cutoff parsing, local-day proof and the persisted
init/raise/never-lower watermark. `test_enable_exact_timestamps.py` covers the patch helper on temp files
(dry run, backup, atomic write, CRLF, permissions, idempotence, every refusal) and checks that the line it
inserts really logs what the parser reads. `test_chat_auto.py` covers journal parsing (including: other channels and
`nyaphelia` ignored, old VODs archived after the cutoff still excluded, boundary day, same-local-day streams
before/after the cutoff with and without the exact record, malformed/out-of-order/duplicate/foreign-context
records, bad stamps, missing `routed to` diagnostics, cutoff persistence, state fail-closed, secrets only in the child environment).
`test_chat_job.py` covers mapping validation, the Nymphelia item allow-list, forward-only queue filtering,
exact video pairing, size+MD5 publication checks, retry/backoff, crash-safe upload, locks and the deploy hook.
The tz-dependent tests need a tz database (`pip install tzdata` on Windows).

## Deploying to the VM

**Current status (2026-10-21):**

* Baseline verified on the VM with Python 3.10: all 206 tests pass; subsequent review fixes require revalidation.
* Dry run (`chat_auto.py`, no `--run`): all 7 existing VODs excluded as `beforeCutoff`, zero candidates, zero warnings.
* Units installed as shipped. The first `--run --publish --deploy` exited 0 with an empty mapping and the persisted
  cutoff `2026-10-22T04:00:00Z` (`initializedAt` `2026-10-22T04:17:07Z`).
* `nymphelia-chat.timer` is enabled and running (re-enabled after the final review fixes were installed).
* The exact-timestamp helper is installed. The shared updater differs by exactly one added log line;
  its backup is `/opt/vodsync/vodsync.py.bak-exact-ts-20261022T042914Z`.
* `vodsync.service` and `vodrec` were not restarted, and the Smizzles chat tooling under
  `/opt/vodsync/chat` was not modified.

The commands below are the reusable install and operate steps used for this deploy. Replace `<vm-ip>` with the VM address
(kept out of this repo's docs). Live values confirmed on the VM: user `ubuntu`, `/opt/vodsync/vodsync.py`
emits `routed to`, shared `/opt/vodsync/chat/bin/TwitchDownloaderCLI` and `/opt/vodsync/venv/bin/ia`, config
channel `nymphelia` (`syncFromTwitch`, collections `…-ASMR-2` and `…-ASMR`, deploy hook present). The existing
Smizzles files under `/opt/vodsync/chat` and its `smizzles-chat.*` units are not touched: this uses its own
directory, state, queue, lock, units and the Nymphelia hook only. Review the files first, then:

```bash
# 1. workstation: copy the code and units (nothing else)
scp scripts/chat-sync/{chat_auto,chat_job,chat_sync,forward_only}.py ubuntu@<vm-ip>:/tmp/
scp scripts/chat-sync/systemd/nymphelia-chat.{service,timer} ubuntu@<vm-ip>:/tmp/

# 2. VM: install into an isolated directory
ssh ubuntu@<vm-ip>
sudo install -d -o ubuntu -g ubuntu -m 0700 /opt/vodsync/chat-nymphelia
install -m 0600 /tmp/chat_auto.py /tmp/chat_job.py /tmp/chat_sync.py /tmp/forward_only.py /opt/vodsync/chat-nymphelia/

# 2b. ALREADY APPLIED on this VM; needed on a fresh VM for same-day cutoff streams (see "Exact start" above):
#     copy the helper and review what it would do. Dry run by default; --apply writes a backup + atomic replace.
#     (from the workstation)  scp scripts/chat-sync/enable-exact-timestamps.py ubuntu@<vm-ip>:/tmp/
python3 /tmp/enable-exact-timestamps.py                      # prints state "patched" (would change) or "refused" + reason
sha256sum /opt/vodsync/vodsync.py                            # record it; pass --expect-sha256 <hash> to pin what you reviewed
python3 /tmp/enable-exact-timestamps.py --apply              # as the file's owner; no service is restarted
#     undo: cp /opt/vodsync/vodsync.py.bak-exact-ts-<stamp> /opt/vodsync/vodsync.py

# 3. VM: preflight (all read-only)
id ubuntu                                                   # needs group adm or systemd-journal to read the journal
/opt/vodsync/venv/bin/python -c "import zoneinfo; zoneinfo.ZoneInfo('America/Mexico_City'); print('tz ok')"
journalctl -u vodsync.service --since "2 days ago" -o cat | grep -m3 "routed to"    # route line present
/opt/vodsync/chat/bin/TwitchDownloaderCLI --help >/dev/null && echo downloader ok
/opt/vodsync/venv/bin/ia --version

# 4. VM: dry run. Read-only: prints the plan, writes nothing
cd /opt/vodsync/chat-nymphelia && /opt/vodsync/venv/bin/python chat_auto.py

# 5. VM: install the units and start the hourly timer
sudo cp /tmp/nymphelia-chat.service /tmp/nymphelia-chat.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nymphelia-chat.timer     # the boot delay has long passed, so the first run starts right away
systemctl list-timers nymphelia-chat.timer
journalctl -u nymphelia-chat.service -n 50 --no-pager
```

Requirements (all checked on the VM):

* **VM user and units**: `User=ubuntu`; change with `sudo systemctl edit nymphelia-chat.service` if different.
  The user must read `/opt/vodsync/config.json` (chmod 600, owned by it) and the `ia` credentials
  (`~/.config/internetarchive/ia.ini`), and read the system journal.
* **tzdata** in the VM python (`zoneinfo`); step 3 checks it. Without it the tool exits with a config error
  rather than guessing a timezone.
* **`forward-only.json`** is written by the first `--run` and is the source of truth from then on. The cutoff can only
  be raised; to change it, edit the unit's `--not-before` only with a deliberate raise, never a lower value.
* **Item rollover**: when `NYMPHELIA-2026-ASMR-3` is created, add it to `channels.nymphelia.collections` in
  `config.json` (already required by vodsync); the allow-list follows the config with no code change.
* **Exact start for the cutoff day**: without `enable-exact-timestamps.py`, a stream on the cutoff's own local
  day (10-21-26) is excluded even if it began after 22:00 (`ambiguousDay`). Apply the helper *before* such a VOD
  is archived; it only affects VODs vodsync downloads after the patch, and a VOD already logged without the record
  cannot be requalified from the journal (map it by hand with an explicit `earliestStartUtc` if wanted). The helper
  refuses unless the anchor `log.info("  VOD %s  [%s] %s", v["id"], stamp, v["title"][:60])` is present exactly
  once and `timezone` is already imported, so a different live `vodsync.py` is left untouched.
* **Expected quiet period**: until a VOD streamed on/after 2026-10-22 is archived by vodsync, runs map nothing
  (`new: []`, `beforeCutoff` > 0) and exit 0. Exit 1 always means a warning, a conflict or a job error.
* **Frontend** (reads `<stem>.chat.json`, in `src/watch/chat/` of the website repo): deployed. VODs without a sidecar
  show no chat panel.

Operating it:

```bash
systemctl list-timers nymphelia-chat.timer
sudo systemctl start nymphelia-chat.service        # run now (only after reviewing the dry run)
sudo systemctl disable --now nymphelia-chat.timer  # pause
cat /opt/vodsync/chat-nymphelia/forward-only.json  # the persisted cutoff
```
