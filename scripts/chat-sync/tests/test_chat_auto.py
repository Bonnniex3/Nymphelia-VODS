"""Offline tests for chat_auto.py: python -I -m unittest discover -s scripts/chat-sync/tests
No journalctl, network, ia CLI or downloader: the journal is synthetic and the job runner is patched."""
from datetime import datetime, timedelta, timezone
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import chat_auto as ca  # noqa: E402
import chat_job as cj  # noqa: E402
import chat_sync as cs  # noqa: E402
import forward_only as fo  # noqa: E402

try:
    from zoneinfo import ZoneInfo
    ZoneInfo("America/Mexico_City")
except Exception:                       # no tz database on this machine: only MainTests need it
    ZoneInfo = None

INV = "a" * 32
FILE = "[10-22-26] nymphelia - a stream.mp4"
ITEM = "NYMPHELIA-2026-ASMR-2"
OLD_ITEM = "NYMPHELIA-2026-ASMR"
GAMING_ITEM = "NYMPHELIA-GAMING26"
MEXICO = timezone(timedelta(hours=-6))              # America/Mexico_City has had no DST since 2022
CUTOFF = fo.parse_utc(fo.DEFAULT_NOT_BEFORE)        # 2026-10-22T04:00:00Z = Oct 21 22:00 local
START = "2026-10-22T06:00:00Z"                      # earliest instant of the local day 10-22-26
POLICY = ca.Policy({ITEM, OLD_ITEM}, MEXICO, CUTOFF)


def rec(message, inv=INV):
    if isinstance(message, str):           # real vodsync lines carry a time/level prefix
        message = "07:11:07 INFO " + message
    return {"MESSAGE": message, "_SYSTEMD_INVOCATION_ID": inv}


def block(vod="2500000001", item=ITEM, name=FILE, channel="nymphelia", inv=INV, stamp="10-22-26", route=True,
          exact=None):
    lines = [rec(f"=== {channel} ===", inv), rec(f"  VOD {vod}  [{stamp}] a stream", inv)]
    if exact is not None:                   # the optional line enable-exact-timestamps.py makes vodsync print
        lines.append(rec(f"    source published at {exact}", inv))
    if route:
        lines.append(rec(f"    routed to {item} (default)", inv))
    return lines + [rec(f"    downloading + remuxing -> {name}", inv)]


def entry(vod="2500000001", item=ITEM, name=FILE, offset=0, start=START):
    return {"twitchVodId": vod, "iaItem": item, "videoFile": name, "offsetSeconds": offset, "earliestStartUtc": start}


def derive(records, policy=POLICY):
    stats = {}
    return ca.derive_entries(records, policy, stats), stats


class ParserTests(unittest.TestCase):
    def test_valid_block(self):
        self.assertEqual(derive(block())[0], [entry()])
        self.assertEqual(block()[0]["MESSAGE"], "07:11:07 INFO === nymphelia ===")
        self.assertEqual(block()[1]["MESSAGE"], "07:11:07 INFO   VOD 2500000001  [10-22-26] a stream")

    def test_unprefixed_lines_and_authenticated_suffix(self):
        records = [{"MESSAGE": m, "_SYSTEMD_INVOCATION_ID": INV} for m in
                   ("=== Nymphelia ===  (authenticated)", "  VOD 5  [10-22-26] t", f"    routed to {ITEM}",
                    f"    downloading + remuxing -> {FILE}")]
        self.assertEqual(derive(records)[0], [entry("5")])

    def test_both_asmr_items_and_trailing_text_after_route(self):
        got, _ = derive(block() + block("2500000002", OLD_ITEM, "b - [2].mp4"))
        self.assertEqual([e["iaItem"] for e in got], [ITEM, OLD_ITEM])

    def test_other_channels_are_ignored_including_the_live_recorded_nyaphelia(self):
        for channel in ("nyaphelia", "smizzles", "kukuroneko", "minorikyun", "nymphelia2"):
            with self.subTest(channel=channel):
                got, stats = derive(block(channel=channel))
                self.assertEqual((got, stats["channelBlocks"], stats["vods"]), ([], 0, 0))
        # even with its own gaming item and a forward date: a nyaphelia block never maps
        self.assertEqual(derive(block(channel="nyaphelia", item=GAMING_ITEM))[0], [])

    def test_foreign_items_and_bad_files_ignored(self):
        got, stats = derive(block(item=GAMING_ITEM))
        self.assertEqual((got, stats["foreignItem"]), ([], 1))
        self.assertEqual(derive(block(item="SmizzlesGaming26"))[0], [])
        self.assertEqual(derive(block(name="x.mkv"))[0], [])
        self.assertEqual(derive(block(name="../x.mp4"))[0], [])

    def test_channel_boundary_resets_context(self):
        records = block()[:3] + [rec("=== kukuroneko ==="), rec("=== nymphelia ===")] + block()[3:]
        self.assertEqual(derive(records)[0], [])
        # a route from channel A must not leak into a later non-routed VOD of channel B
        records = block()[:3] + [rec("=== nymphelia ==="), rec("  VOD 9  [10-22-26] t"), block()[3]]
        self.assertEqual(derive(records)[0], [])

    def test_vod_boundary_no_stale_route_or_download(self):
        records = [rec("=== nymphelia ==="), rec("  VOD 1  [10-22-26] t"), rec(f"    routed to {ITEM} (x)"),
                   rec("  VOD 2  [10-22-26] t"), rec(f"    downloading + remuxing -> {FILE}")]
        self.assertEqual(derive(records)[0], [])
        # second download line without a fresh VOD line yields nothing more
        records = block() + [rec("    downloading + remuxing -> other.mp4")]
        self.assertEqual(derive(records)[0], [entry()])
        # duplicate route is ambiguous
        records = block()[:3] + [rec(f"    routed to {ITEM} (x)"), block()[3]]
        self.assertEqual(derive(records)[0], [])

    def test_invocation_boundary(self):
        other = "b" * 32
        records = block()[:2] + [rec(f"    routed to {ITEM} (x)", other)] + block()[3:]
        self.assertEqual(derive(records)[0], [])
        records = [rec("=== nymphelia ===", other), rec("  VOD 7  [10-22-26] t")] + block()[:3] + \
            [rec("    downloading + remuxing -> z.mp4", other)] + block()[3:]
        self.assertEqual(derive(records)[0], [entry()])    # other invocation never got a route

    def test_interleaved_invocations(self):
        other = block("2500000009", OLD_ITEM, "o - [9].mp4", inv="b" * 32)
        interleaved = [r for pair in zip(block(), other) for r in pair]
        self.assertEqual(derive(interleaved)[0], [entry(), entry("2500000009", OLD_ITEM, "o - [9].mp4")])

    def test_missing_route_or_vod(self):
        records = block()
        self.assertEqual(derive(records[:2] + records[3:])[0], [])
        self.assertEqual(derive(records[:1] + records[2:])[0], [])

    def test_truncated_or_garbled_records(self):
        self.assertEqual(derive(block()[:3])[0], [])
        self.assertEqual(derive(block()[:3] + [None] + block()[3:])[0], [])
        self.assertEqual(derive(block()[:2] + [rec(None)] + block()[2:])[0], [])
        self.assertEqual(derive(block()[:2] + [rec([104, 105])] + block()[2:])[0], [])
        self.assertEqual(derive([{"MESSAGE": block()[3]["MESSAGE"]}])[0], [])   # no invocation id
        lines = [b"not json", b"[1]", b'{"MESSAGE": "x"']
        self.assertEqual(ca.parse_journal(lines, POLICY), [])

    def test_parse_journal_bytes_and_repeat_same_target(self):
        lines = [json.dumps(r).encode() for r in block() + block(inv="c" * 32)]
        self.assertEqual(ca.parse_journal(lines, POLICY), [entry()])

    def test_same_vod_different_target_conflicts(self):
        with self.assertRaises(ca.ConflictError):
            derive(block() + block(name="different - [2].mp4", inv="c" * 32))


class ForwardOnlyParserTests(unittest.TestCase):
    """The cutoff is the stream's own local date, never the time vodsync archives it."""

    def test_vod_streamed_before_the_cutoff_is_not_mapped_even_if_archived_after_it(self):
        # vodsync is only getting to this August VOD now (journal line is "today"): still no chat.
        got, stats = derive(block(stamp="08-27-26", name="[08-27-26] nymphelia - old.mp4"))
        self.assertEqual((got, stats["beforeCutoff"], stats["downloads"], stats["unrouted"]), ([], 1, 0, 0))

    def test_local_day_boundary_is_conservative(self):
        # 10-21-26 starts 2026-10-21T06:00Z < cutoff: excluded even though its late evening is after it.
        self.assertEqual(derive(block(stamp="10-21-26"))[0], [])
        self.assertEqual(derive(block(stamp="10-22-26"))[0], [entry()])
        self.assertEqual(derive(block(stamp="10-23-26"))[0][0]["earliestStartUtc"], "2026-10-23T06:00:00Z")
        self.assertEqual(derive(block(stamp="01-05-27"))[0][0]["earliestStartUtc"], "2027-01-05T06:00:00Z")

    def test_cutoff_is_inclusive_and_a_later_cutoff_excludes(self):
        exact = ca.Policy({ITEM}, MEXICO, fo.parse_utc(START))
        self.assertEqual(derive(block(), exact)[0], [entry()])
        later = ca.Policy({ITEM}, MEXICO, fo.parse_utc("2026-10-22T06:00:01Z"))
        self.assertEqual(derive(block(), later)[0], [])

    def test_timezone_changes_the_local_day_start(self):
        # the same stamp is the start of a different instant per timezone; UTC midnight is before the cutoff
        utc = ca.Policy({ITEM}, timezone.utc, CUTOFF)
        self.assertEqual(derive(block(stamp="10-22-26"), utc)[0], [])
        self.assertEqual(derive(block(stamp="10-22-26"), POLICY)[0], [entry()])

    def test_unparseable_stamps_are_never_forward(self):
        for stamp in ("10/22/26", "13-45-26", "2-3-26", "", "10-22-2026", "tomorrow"):
            with self.subTest(stamp=stamp):
                got, stats = derive(block(stamp=stamp))
                self.assertEqual((got, stats["badDate"], stats["downloads"]), ([], 1, 0))

    def test_old_and_new_vods_in_one_invocation(self):
        old = [rec("  VOD 1  [08-27-26] old"), rec(f"    routed to {ITEM} (default)"),
               rec("    downloading + remuxing -> [08-27-26] nymphelia - old.mp4")]
        new = block("2", name="[10-23-26] nymphelia - new.mp4", stamp="10-23-26")
        got, stats = derive([new[0]] + old + new[1:])
        self.assertEqual([e["twitchVodId"] for e in got], ["2"])
        self.assertEqual((stats["vods"], stats["beforeCutoff"]), (2, 1))


EVENING = "2026-10-22T04:30:00Z"      # 22:30 local on 10-21-26: same local day as before-cutoff streams, after the cutoff
BEFORE = "2026-10-22T03:59:59Z"       # 21:59:59 local on 10-21-26: one second before the cutoff


class ExactStartTests(unittest.TestCase):
    """The optional `source published at` record, held per channel/VOD context until route/download."""

    def test_same_local_day_after_the_cutoff_qualifies_with_the_exact_start(self):
        got, stats = derive(block(stamp="10-21-26", exact=EVENING))
        self.assertEqual(got, [entry(start=EVENING)])
        self.assertEqual((stats["exactStarts"], stats["ambiguousDay"], stats["beforeCutoff"]), (1, 0, 0))

    def test_same_local_day_before_the_cutoff_stays_excluded(self):
        got, stats = derive(block(stamp="10-21-26", exact=BEFORE))
        self.assertEqual((got, stats["beforeCutoff"], stats["exactStarts"], stats["downloads"]), ([], 1, 0, 0))
        self.assertEqual(ca.warnings_for(stats), [])

    def test_the_cutoff_second_itself_qualifies(self):
        self.assertEqual(derive(block(stamp="10-21-26", exact=fo.DEFAULT_NOT_BEFORE))[0],
                         [entry(start=fo.DEFAULT_NOT_BEFORE)])

    def test_straddling_day_without_a_record_is_excluded_never_guessed(self):
        for route in (True, False):
            with self.subTest(route=route):
                got, stats = derive(block(stamp="10-21-26", route=route))
                self.assertEqual((got, stats["ambiguousDay"], stats["unrouted"], stats["downloads"]), ([], 1, 0, 0))
        self.assertEqual(ca.warnings_for(derive(block(stamp="10-21-26"))[1]), [])   # legacy logs are not an error

    def test_legacy_later_day_logs_still_work_and_a_consistent_record_refines_them(self):
        self.assertEqual(derive(block(stamp="10-22-26"))[0], [entry()])               # day start, as before
        later = "2026-10-22T07:15:00Z"                                                # 01:15 local on 10-22-26
        got, stats = derive(block(stamp="10-22-26", exact=later))
        self.assertEqual((got, stats["exactStarts"]), ([entry(start=later)], 1))

    def test_record_that_disagrees_with_the_stamp_fails_safe(self):
        for stamp, exact in (("10-22-26", "2026-10-21T05:00:00Z"),      # 10-20 23:00 local
                             ("10-21-26", "2026-10-23T05:00:00Z"),      # 10-22 23:00 local
                             ("10-22-26", "2026-10-22T05:59:59Z")):     # 23:59:59 local on 10-21
            with self.subTest(stamp=stamp, exact=exact):
                got, stats = derive(block(stamp=stamp, exact=exact))
                self.assertEqual((got, stats["inconsistentDate"], stats["downloads"]), ([], 1, 0))
                self.assertEqual(ca.warnings_for(stats), ["timestamp_invalid"])

    def test_a_record_cannot_revive_a_day_that_is_entirely_before_the_cutoff(self):
        got, stats = derive(block(stamp="10-20-26", exact="2026-10-22T05:00:00Z"))
        self.assertEqual((got, stats["beforeCutoff"], stats["inconsistentDate"], stats["badTimestamp"]), ([], 1, 0, 0))

    def test_malformed_records_kill_the_context(self):
        for bad in ("2026-10-22T04:30:00", "2026-10-22 04:30:00Z", "2026-13-22T04:30:00Z", "2026-10-22T25:30:00Z",
                    "2026-10-22T04:30:00+00:00", "garbage", "", "2026-10-22T04:30:00Z extra"):
            with self.subTest(bad=bad):
                got, stats = derive(block(stamp="10-21-26", exact=bad))
                self.assertEqual((got, stats["badTimestamp"], stats["exactStarts"]), ([], 1, 0))
                self.assertEqual(ca.warnings_for(stats), ["timestamp_invalid"])
        # even on a forward day a malformed record is not ignored: the context is untrustworthy
        self.assertEqual(derive(block(stamp="10-22-26", exact="nope"))[0], [])

    def test_out_of_order_records_do_not_qualify_or_revive(self):
        lines = block(stamp="10-21-26")
        vod, route, download = lines[1], lines[2], lines[3]
        stamp_line = rec(f"    source published at {EVENING}")
        got, stats = derive([lines[0], vod, route, stamp_line, download])
        self.assertEqual((got, stats["ambiguousDay"]), ([], 1))          # route already ended the straddling VOD
        self.assertEqual(derive([lines[0], vod, route, download, stamp_line])[0], [])
        forward = block(stamp="10-22-26")
        self.assertEqual(derive([forward[0], forward[1], forward[2], stamp_line, forward[3]])[0], [])   # kills a good one
        self.assertEqual(derive([forward[0], forward[1], forward[2], forward[3], stamp_line])[0], [entry()])   # entry stands

    def test_duplicate_records_kill_the_context(self):
        lines = block(stamp="10-21-26", exact=EVENING)
        got, stats = derive([lines[0], lines[1], lines[2], lines[2], lines[3], lines[4]])
        self.assertEqual((got, stats["badTimestamp"], stats["exactStarts"]), ([], 1, 1))
        # a second, even contradicting, record cannot rewrite the first either
        other = rec(f"    source published at {BEFORE}")
        self.assertEqual(derive([lines[0], lines[1], lines[2], other, lines[3], lines[4]])[0], [])

    def test_record_before_the_vod_line_or_for_another_vod_never_carries_over(self):
        lines = block(stamp="10-21-26")
        early = [lines[0], rec(f"    source published at {EVENING}")] + lines[1:]
        got, stats = derive(early)
        self.assertEqual((got, stats["badTimestamp"], stats["ambiguousDay"]), ([], 1, 1))
        first = block("1", stamp="10-22-26", exact="2026-10-22T08:00:00Z")
        second = [rec("  VOD 2  [10-21-26] next"), rec(f"    routed to {ITEM} (default)"),
                  rec("    downloading + remuxing -> [10-21-26] nymphelia - next.mp4")]
        got, stats = derive(first + second)
        self.assertEqual([e["twitchVodId"] for e in got], ["1"])           # VOD 2 does not inherit VOD 1's start
        self.assertEqual(stats["ambiguousDay"], 1)

    def test_record_from_another_invocation_does_not_qualify(self):
        other = "b" * 32
        lines = block(stamp="10-21-26")
        records = [lines[0], lines[1], rec(f"    source published at {EVENING}", other), lines[2], lines[3]]
        got, stats = derive(records)
        self.assertEqual((got, stats["exactStarts"], stats["ambiguousDay"]), ([], 0, 1))

    def test_dead_contexts_ignore_records(self):
        for channel in ("nyaphelia", "smizzles"):
            got, stats = derive(block(channel=channel, stamp="10-22-26", exact=EVENING))
            self.assertEqual((got, stats["exactStarts"], stats["badTimestamp"]), ([], 0, 0))
        # a garbled journal line between VOD and record kills the context; the record cannot bring it back
        lines = block(stamp="10-21-26", exact=EVENING)
        self.assertEqual(derive([lines[0], lines[1], None, lines[2], lines[3], lines[4]])[0], [])
        self.assertEqual(derive([lines[0], lines[1], rec(None), lines[2], lines[3], lines[4]])[0], [])
        # a foreign route kills it first
        self.assertEqual(derive(block(stamp="10-21-26", exact=EVENING, item=GAMING_ITEM))[0], [])

    def test_unpatched_then_patched_sightings_of_one_vod_merge_to_the_exact_start(self):
        old = block(stamp="10-22-26", inv="c" * 32)
        new = block(stamp="10-22-26", exact="2026-10-22T08:00:00Z", inv="d" * 32)
        merged = derive(old + new)[0]
        self.assertEqual(merged, [entry(start="2026-10-22T08:00:00Z")])
        self.assertEqual(derive(new + old)[0], merged)

    def test_exact_start_in_other_timezone_uses_that_timezone_for_consistency(self):
        utc = ca.Policy({ITEM}, timezone.utc, CUTOFF)
        got, _ = derive(block(stamp="10-22-26", exact="2026-10-22T04:30:00Z"), utc)
        self.assertEqual(got, [entry(start="2026-10-22T04:30:00Z")])            # stamp day 10-22 UTC straddles
        self.assertEqual(derive(block(stamp="10-21-26", exact="2026-10-22T04:30:00Z"), utc)[0], [])   # inconsistent in UTC

    def test_line_format_is_what_the_parser_reads(self):
        line = "    source published at " + datetime(2026, 10, 22, 4, 30, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.assertTrue(ca.SOURCE_RE.fullmatch(line))


class DiagnosticTests(unittest.TestCase):
    def test_forward_download_without_route_line_is_counted_not_silent(self):
        got, stats = derive(block(route=False))
        self.assertEqual((got, stats["downloads"], stats["unrouted"]), ([], 1, 1))
        self.assertEqual(ca.warnings_for(stats), ["route_missing"])

    def test_routed_download_is_clean(self):
        _, stats = derive(block())
        self.assertEqual((stats["channelBlocks"], stats["downloads"], stats["unrouted"], ca.warnings_for(stats)),
                         (1, 1, 0, []))

    def test_channel_never_seen_is_flagged(self):
        _, stats = derive([])
        self.assertEqual(ca.warnings_for(stats), ["channel_not_seen"])
        _, stats = derive(block(channel="nyaphelia"))
        self.assertEqual(ca.warnings_for(stats), ["channel_not_seen"])

    def test_item_outside_the_collections_is_flagged(self):
        _, stats = derive(block(item=GAMING_ITEM))
        self.assertEqual(ca.warnings_for(stats), ["item_not_allowed"])

    def test_bad_or_contradicting_timestamps_warn(self):
        self.assertEqual(ca.warnings_for(derive(block(stamp="10-21-26", exact="x"))[1]), ["timestamp_invalid"])
        self.assertEqual(ca.warnings_for(derive(block(stamp="10-22-26", exact="2026-10-20T10:00:00Z"))[1]), ["timestamp_invalid"])

    def test_old_vods_only_is_not_a_warning(self):
        _, stats = derive(block(stamp="08-27-26", route=False))
        self.assertEqual(ca.warnings_for(stats), [])


class MergeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "mapping.json"

    def write(self, *entries, **extra):
        self.path.write_text(json.dumps({"version": 1, "entries": list(entries), **extra}), encoding="utf-8")

    def test_missing_file_and_idempotent(self):
        doc, added = ca.merge_mapping(self.path, [entry()])
        self.assertEqual((doc, added), ({"version": 1, "entries": [entry()]}, [entry()]))
        self.write(*doc["entries"])
        self.assertEqual(ca.merge_mapping(self.path, [entry()])[1], [])

    def test_preserves_manual_entries_notes_and_offsets(self):
        manual = entry("1", name="manual - [1].mp4", offset=-3.5)
        manual["note"] = "hand verified"
        self.write(manual, other="kept")
        doc, added = ca.merge_mapping(self.path, [entry(), entry("1", name="manual - [1].mp4", offset=0)])
        self.assertEqual(doc, {"version": 1, "entries": [manual, entry()], "other": "kept"})
        self.assertEqual(added, [entry()])

    def test_conflicts_rejected(self):
        self.write(entry())
        with self.assertRaises(ca.ConflictError):           # same id, different file
            ca.merge_mapping(self.path, [entry(name="else - [2].mp4")])
        with self.assertRaises(ca.ConflictError):           # same id, different item
            ca.merge_mapping(self.path, [entry(item=OLD_ITEM)])
        with self.assertRaises(ca.ConflictError):           # same item+sidecar stem, different id
            ca.merge_mapping(self.path, [entry("2500000002")])

    def test_invalid_existing_mapping_is_not_replaced(self):
        self.path.write_text("garbage", encoding="utf-8")
        with self.assertRaises(cs.ChatSyncError):
            ca.merge_mapping(self.path, [entry()])

    def test_gaming_item_in_an_existing_mapping_is_refused(self):
        self.write(entry(item=GAMING_ITEM))
        with self.assertRaises(cs.ChatSyncError):
            ca.merge_mapping(self.path, [])


def config(**channel):
    nymphelia = {"channel": "nymphelia", "syncFromTwitch": True, "defaultItemId": ITEM,
                 "collections": {"asmr": ITEM, "asmr-full": OLD_ITEM},
                 "vercelDeployHook": "https://h.example/SECRET", **channel}
    return {"timezone": "America/Mexico_City",
            "channels": {"nymphelia": nymphelia,
                         "nyaphelia": {"channel": "nyaphelia", "liveRecord": True,
                                       "collections": {"gaming": GAMING_ITEM}, "vercelDeployHook": "https://g.example/G"}}}


@unittest.skipIf(ZoneInfo is None, "tz database unavailable (pip install tzdata)")
class MainTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.mapping = self.dir / "mapping.json"
        self.forward = self.dir / "forward-only.json"
        self.config = self.dir / "config.json"
        self.config.write_text(json.dumps(config()))
        self.journal(block())

    def journal(self, records):
        lines = [json.dumps(r).encode() for r in records]
        patcher = mock.patch.object(ca, "read_journal", return_value=lines)
        patcher.start()
        self.addCleanup(patcher.stop)

    def main(self, *flags, job_code=0):
        out = io.StringIO()
        argv = ["--mapping", str(self.mapping), "--work-dir", str(self.dir / "q"), "--config", str(self.config),
                "--downloader", "dl", "--ia-command", "ia", *flags]
        with redirect_stdout(out), mock.patch.object(ca.subprocess, "run") as run:
            run.return_value.returncode = job_code
            code = ca.main(argv)
        return code, out.getvalue(), run

    def test_defaults_are_isolated_from_the_smizzles_chat_dir(self):
        self.assertEqual(ca.ROOT, "/opt/vodsync/chat-nymphelia")
        self.assertEqual((ca.CHANNEL, ca.HOOK_ENV), ("nymphelia", "NYMPHELIA_CHAT_DEPLOY_HOOK"))

    def test_plan_writes_nothing_and_runs_nothing(self):
        code, out, run = self.main()
        plan = json.loads(out)
        self.assertEqual((code, plan["new"], self.mapping.exists(), self.forward.exists()), (0, [entry()], False, False))
        self.assertEqual((plan["notBefore"], plan["cutoffState"], plan["warnings"]), (fo.DEFAULT_NOT_BEFORE, "initialized", []))
        self.assertEqual(plan["journal"]["channelBlocks"], 1)
        run.assert_not_called()

    def test_plan_surfaces_a_missing_route_instead_of_an_empty_plan(self):
        self.journal(block(route=False))
        code, out, _ = self.main()
        plan = json.loads(out)
        self.assertEqual((code, plan["new"], plan["warnings"]), (0, [], ["route_missing"]))
        self.assertEqual(plan["journal"]["unrouted"], 1)

    def test_flag_dependencies(self):
        for flags in (["--publish"], ["--deploy"], ["--run", "--deploy"]):
            with self.subTest(flags=flags):
                self.assertEqual(self.main(*flags)[0], 1)

    def test_first_run_persists_the_cutoff_and_invokes_job_with_forward_state_and_items(self):
        code, out, run = self.main("--run", "--publish", "--deploy")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(self.mapping.read_text())["entries"], [entry()])
        self.assertEqual(json.loads(self.forward.read_text())["notBefore"], fo.DEFAULT_NOT_BEFORE)
        command, kwargs = run.call_args[0][0], run.call_args[1]
        self.assertEqual(command[0], sys.executable)
        self.assertEqual(command[2:], ["--mapping", str(self.mapping), "--work-dir", str(self.dir / "q"),
                                       "--downloader", "dl", "--ia-command", "ia",
                                       "--forward-state", str(self.forward),
                                       "--allowed-item", OLD_ITEM, "--allowed-item", ITEM,
                                       "--run", "--publish", "--deploy-hook-env", ca.HOOK_ENV])
        self.assertNotIn("--allow-backfill", command)
        self.assertNotIn(GAMING_ITEM, command)
        self.assertEqual(kwargs["env"][ca.HOOK_ENV], "https://h.example/SECRET")
        self.assertNotIn("SECRET", out + " ".join(command))
        self.assertNotIn("G.example", out + " ".join(command))        # the gaming hook is never read

    def test_tonights_stream_after_the_cutoff_is_mapped_with_its_exact_start(self):
        self.journal(block(stamp="10-21-26", exact=EVENING, name="[10-21-26] nymphelia - tonight.mp4")
                     + block("2", stamp="10-21-26", exact=BEFORE, name="[10-21-26] nymphelia - earlier.mp4", inv="c" * 32)
                     + block("3", stamp="10-21-26", name="[10-21-26] nymphelia - legacy.mp4", inv="d" * 32))
        code, out, run = self.main("--run")
        self.assertEqual(code, 0)
        entries = json.loads(self.mapping.read_text())["entries"]
        self.assertEqual([(e["twitchVodId"], e["earliestStartUtc"]) for e in entries], [("2500000001", EVENING)])
        journal = json.loads(out)["journal"]
        self.assertEqual((journal["exactStarts"], journal["beforeCutoff"], journal["ambiguousDay"]), (1, 1, 1))
        self.assertEqual(json.loads(out)["warnings"], [])

    def test_old_vods_in_the_journal_never_reach_the_mapping_or_the_queue(self):
        self.journal(block("1", name="[08-27-26] nymphelia - old.mp4", stamp="08-27-26", inv="c" * 32)
                     + block("2", name="[10-21-26] nymphelia - eve.mp4", stamp="10-21-26", inv="d" * 32) + block())
        code, out, _ = self.main("--run")
        self.assertEqual(code, 0)
        self.assertEqual([e["twitchVodId"] for e in json.loads(self.mapping.read_text())["entries"]], ["2500000001"])
        journal = json.loads(out)["journal"]
        self.assertEqual((journal["beforeCutoff"], journal["ambiguousDay"]), (1, 1))     # 10-21 straddles the cutoff

    def test_first_run_with_only_old_vods_still_initializes_the_watermark_and_backfills_nothing(self):
        self.journal(block("1", name="[08-27-26] nymphelia - old.mp4", stamp="08-27-26"))
        code, out, run = self.main("--run")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(self.mapping.read_text())["entries"], [])
        self.assertTrue(self.forward.exists())
        self.assertEqual(json.loads(out)["added"], 0)

    def test_second_run_uses_the_persisted_cutoff_and_refuses_to_lower_it(self):
        self.forward.write_text(json.dumps({"version": 1, "notBefore": "2026-11-01T00:00:00Z"}))
        code, out, run = self.main("--run", "--not-before", "2026-10-01T00:00:00Z")
        self.assertEqual((code, json.loads(out)), (1, {"status": "error", "kind": "forward_only"}))
        self.assertFalse(self.mapping.exists())
        run.assert_not_called()
        code, out, run = self.main("--run", "--not-before", "2026-11-01T00:00:00Z")   # same value is fine
        self.assertEqual((code, json.loads(out)["cutoffState"], json.loads(out)["added"]), (0, "existing", 0))
        self.assertEqual(json.loads(self.mapping.read_text())["entries"], [])           # Oct 22 VOD is before Nov 1

    def test_raising_the_cutoff_persists_and_excludes_more(self):
        self.main("--run")
        code, out, _ = self.main("--run", "--not-before", "2026-10-30T00:00:00Z")
        self.assertEqual((code, json.loads(out)["cutoffState"]), (0, "raised"))
        self.assertEqual(json.loads(self.forward.read_text())["notBefore"], "2026-10-30T00:00:00Z")
        self.assertIn("initializedAt", json.loads(self.forward.read_text()))     # first-run record is kept

    def test_damaged_forward_state_fails_closed(self):
        self.forward.write_text("{")
        code, out, run = self.main("--run")
        self.assertEqual((code, json.loads(out)["status"], self.mapping.exists()), (1, "error", False))
        run.assert_not_called()
        self.assertEqual(self.forward.read_text(), "{")

    def test_bad_not_before_is_refused(self):
        for value in ("2026-10-22", "2026-10-22T04:00:00", "tomorrow"):
            with self.subTest(value=value):
                code, out, run = self.main("--run", "--not-before", value)
                self.assertEqual((code, json.loads(out)["kind"], run.called), (1, "forward_only", False))

    def test_missing_route_makes_a_run_fail_loudly_even_when_the_job_succeeds(self):
        self.journal(block(route=False))
        code, out, run = self.main("--run")
        self.assertEqual((code, json.loads(out)["warnings"], run.called), (1, ["route_missing"], True))

    def test_empty_journal_makes_a_run_fail_loudly(self):
        self.journal([])
        code, out, _ = self.main("--run")
        self.assertEqual((code, json.loads(out)["warnings"]), (1, ["channel_not_seen"]))

    def test_job_failure_code_is_propagated(self):
        self.assertEqual(self.main("--run", job_code=1)[0], 1)

    def test_run_without_publish_has_no_hook(self):
        _, _, run = self.main("--run")
        self.assertNotIn("--publish", run.call_args[0][0])
        self.assertNotIn(ca.HOOK_ENV, run.call_args[1]["env"])

    def test_missing_hook_in_config_errors_without_leaking(self):
        self.config.write_text(json.dumps(config(vercelDeployHook="http://insecure.example/SECRET")))
        code, out, run = self.main("--run", "--publish", "--deploy")
        self.assertEqual((code, json.loads(out)["status"]), (1, "error"))
        run.assert_not_called()
        self.assertFalse(self.mapping.exists())
        self.assertNotIn("SECRET", out)

    def test_live_recorded_or_unknown_channel_is_refused(self):
        for channel in ("nyaphelia", "kukuroneko"):
            with self.subTest(channel=channel):
                code, out, run = self.main("--channel", channel, "--run")
                self.assertEqual((code, json.loads(out)["status"], run.called), (1, "error", False))
        self.assertFalse(self.mapping.exists())

    def test_config_without_collections_or_with_unknown_timezone_is_refused(self):
        self.config.write_text(json.dumps(config(collections={})))
        self.assertEqual(self.main()[0], 1)
        bad = config()
        bad["timezone"] = "Mars/Olympus"
        self.config.write_text(json.dumps(bad))
        self.assertEqual(self.main()[0], 1)

    def test_conflict_leaves_mapping_untouched(self):
        original = json.dumps({"version": 1, "entries": [entry(name="else - [2].mp4")]})
        self.mapping.write_text(original)
        code, out, run = self.main("--run")
        self.assertEqual((code, json.loads(out)["kind"]), (1, "conflict"))
        self.assertEqual(self.mapping.read_text(), original)
        run.assert_not_called()

    @property
    def quarantine_file(self):
        return self.dir / cj.QUARANTINE_NAME

    def mapped_ids(self):
        return [mapping["twitchVodId"] for mapping in json.loads(self.mapping.read_text())["entries"]]

    def collision(self, *ids):
        return sum((block(vod, inv=str(index) * 32) for index, vod in enumerate(ids, 1)), [])

    def enforce_in_job(self):
        env = {"CHAT_HOOK": "https://h.example/SECRET"}
        with mock.patch.object(cj, "sync_chat") as sync, mock.patch.object(cj, "archive_files") as archive, \
                mock.patch.object(cj, "upload_sidecar") as upload, mock.patch.object(cj, "notify_deploy") as deploy, \
                mock.patch.dict(cj.os.environ, env), redirect_stdout(io.StringIO()) as out:
            code = cj.main(["--mapping", str(self.mapping), "--work-dir", str(self.dir / "q"),
                            "--forward-state", str(self.forward), "--run", "--publish", "--deploy-hook-env", "CHAT_HOOK"])
        for boundary in (sync, archive, upload, deploy):
            boundary.assert_not_called()
        return code, json.loads(out.getvalue())

    def test_stored_mapping_plus_a_derived_collision_is_quarantined_and_never_published(self):
        self.mapping.write_text(json.dumps({"version": 1, "entries": [entry("1")]}))
        self.journal(self.collision("1", "2"))
        code, out, run = self.main("--run", "--publish")
        report = json.loads(out)
        self.assertEqual((code, report["added"], report["quarantined"], report["warnings"]),
                         (1, 0, 1, ["target_quarantined"]))
        record = json.loads(self.quarantine_file.read_text())["targets"][0]
        self.assertEqual((record["iaItem"], record["stem"], record["twitchVodIds"]), (ITEM, FILE[:-4], ["1", "2"]))
        self.assertEqual(self.mapped_ids(), ["1"])
        code, report = self.enforce_in_job()
        self.assertEqual((code, report["quarantined"], report["entries"]), (0, ["1"], {}))

    def test_quarantine_outlives_the_journal_window_of_the_colliding_vod(self):
        self.mapping.write_text(json.dumps({"version": 1, "entries": [entry("1")]}))
        self.journal(self.collision("1", "2"))
        self.main("--run")
        for survivor in ("1", "2"):
            with self.subTest(survivor=survivor):
                self.journal(self.collision(survivor))
                code, out, _ = self.main("--run", "--publish")
                self.assertEqual((code, json.loads(out)["warnings"]), (1, ["target_quarantined"]))
                self.assertEqual(self.mapped_ids(), ["1"])
                self.assertEqual(json.loads(self.quarantine_file.read_text())["targets"][0]["twitchVodIds"], ["1", "2"])
                self.assertEqual(self.enforce_in_job()[1]["quarantined"], ["1"])

    def test_unmapped_collision_blocks_both_and_a_lone_survivor_is_not_admitted_later(self):
        self.journal(self.collision("1", "2"))
        self.main("--run")
        self.assertEqual(json.loads(self.mapping.read_text())["entries"], [])
        self.journal(self.collision("2"))
        code, out, _ = self.main("--run")
        self.assertEqual((code, json.loads(out)["added"]), (1, 0))
        self.assertEqual(json.loads(self.mapping.read_text())["entries"], [])

    def write_mixed_conflict(self):
        old = "[10-22-26] nymphelia - old.mp4"
        stored = {"version": 1, "entries": [entry("1"), entry("3", name=old, start="2026-10-01T00:00:00Z")]}
        self.mapping.write_text(json.dumps(stored))
        self.journal(self.collision("2") + block("3", name="[10-22-26] nymphelia - new.mp4", inv="c" * 32))
        return self.mapping.read_text()

    def test_a_mapping_conflict_cannot_discard_a_detected_collision(self):
        original = self.write_mixed_conflict()
        code, out, run = self.main("--run")
        self.assertEqual((code, json.loads(out)["kind"], run.called), (1, "conflict", False))
        self.assertEqual(self.mapping.read_text(), original)
        record = json.loads(self.quarantine_file.read_text())["targets"][0]
        self.assertEqual((record["iaItem"], record["stem"], record["twitchVodIds"]), (ITEM, FILE[:-4], ["1", "2"]))
        self.journal([])
        code, out, _ = self.main("--run")
        self.assertEqual((code, json.loads(out)["warnings"]), (1, ["channel_not_seen", "target_quarantined"]))
        quarantine = cj.read_quarantine(self.quarantine_file)
        self.assertEqual([cj.is_held(entry(vod), quarantine) for vod in ("1", "2")], [True, True])
        code, report = self.enforce_in_job()
        self.assertEqual((code, report["quarantined"], report["entries"]), (0, ["1"], {}))

    def test_plan_with_a_mixed_conflict_writes_nothing(self):
        original = self.write_mixed_conflict()
        code, out, run = self.main()
        self.assertEqual((code, json.loads(out)["kind"], run.called), (1, "conflict", False))
        self.assertEqual((self.mapping.read_text(), self.quarantine_file.exists(),
                          (self.dir / "mapping-conflicts.json").exists()), (original, False, False))

    def test_a_new_lone_vod_colliding_with_the_stored_mapping_is_quarantined_not_an_error(self):
        self.mapping.write_text(json.dumps({"version": 1, "entries": [entry("1")]}))
        self.journal(self.collision("2"))
        code, out, _ = self.main("--run")
        self.assertEqual((code, "status" in json.loads(out), json.loads(out)["warnings"]), (1, False, ["target_quarantined"]))
        self.assertEqual(json.loads(self.quarantine_file.read_text())["targets"][0]["twitchVodIds"], ["1", "2"])

    def test_plan_reports_persisted_and_new_blocks_and_writes_nothing(self):
        self.mapping.write_text(json.dumps({"version": 1, "entries": [entry("1")]}))
        persisted = {"iaItem": OLD_ITEM, "stem": "gone", "twitchVodIds": ["7"], "detectedAt": "2026-10-22T05:00:00Z"}
        self.quarantine_file.write_text(json.dumps({"version": 1, "targets": [persisted]}))
        self.journal(self.collision("1", "2"))
        before = self.quarantine_file.read_text()
        code, out, run = self.main()
        plan = json.loads(out)
        self.assertEqual((code, plan["new"], plan["heldMappings"]), (0, [], ["1"]))
        self.assertEqual([(record["stem"], record["twitchVodIds"]) for record in plan["quarantined"]],
                         [("gone", ["7"]), (FILE[:-4], ["1", "2"])])
        self.assertEqual(self.quarantine_file.read_text(), before)
        run.assert_not_called()

    def test_malformed_quarantine_stops_the_run_before_any_change(self):
        original = json.dumps({"version": 1, "entries": []})
        self.mapping.write_text(original)
        self.quarantine_file.write_text("{")
        for flags in ((), ("--run",)):
            with self.subTest(flags=flags):
                code, out, run = self.main(*flags)
                self.assertEqual((code, json.loads(out)["status"], run.called), (1, "error", False))
        self.assertEqual((self.mapping.read_text(), self.quarantine_file.read_text()), (original, "{"))

    def test_explicit_resolution_keeps_one_vod_and_the_other_stays_blocked_forever(self):
        self.mapping.write_text(json.dumps({"version": 1, "entries": [entry("1")]}))
        self.journal(self.collision("1", "2"))
        self.main("--run")
        resolve = ["--resolve-quarantine", ITEM, FILE, "--keep-vod"]
        code, out, run = self.main(*resolve, "1")
        self.assertEqual((code, json.loads(out)["resolved"]["keepTwitchVodId"], run.called), (0, "1", False))
        for journal in (self.collision("1", "2"), self.collision("2"), self.collision("1")):
            self.journal(journal)
            code, out, _ = self.main("--run")
            self.assertEqual((code, json.loads(out)["warnings"], json.loads(out)["added"]), (0, [], 0))
            self.assertEqual(self.mapped_ids(), ["1"])
        kept = cj.read_mapping(self.mapping)
        quarantine = cj.read_quarantine(self.quarantine_file)
        self.assertEqual([cj.is_held(mapping, quarantine) for mapping in kept], [False])
        self.assertTrue(cj.is_held(entry("2"), quarantine))

    def test_resolution_refuses_unknown_targets_foreign_vods_and_a_conflicting_mapping(self):
        resolve = ["--resolve-quarantine", ITEM, FILE, "--keep-vod"]
        self.assertEqual(json.loads(self.main(*resolve, "1")[1])["kind"], "conflict")
        self.mapping.write_text(json.dumps({"version": 1, "entries": [entry("2")]}))
        self.journal(self.collision("1", "2"))
        self.main("--run")
        self.assertEqual(json.loads(self.main(*resolve, "9")[1])["kind"], "conflict")
        self.assertEqual(json.loads(self.main(*resolve, "1")[1])["kind"], "conflict")
        self.assertNotIn("keepTwitchVodId", self.quarantine_file.read_text())
        for flags in (["--resolve-quarantine", ITEM, FILE], [*resolve, "1", "--run"]):
            with self.subTest(flags=flags):
                self.assertEqual(self.main(*flags)[0], 1)
        self.assertEqual(self.main(*resolve, "2")[0], 0)


class FakeProc:
    def __init__(self, data, code=0):
        self.stdout, self.code, self.killed = io.BytesIO(data), code, False

    def kill(self):
        self.killed = True

    def wait(self):
        return self.code


class JournalReadTests(unittest.TestCase):
    def read(self, proc):
        with mock.patch.object(ca.subprocess, "Popen", return_value=proc) as popen:
            result = ca.read_journal("journalctl", "vodsync.service", 14, 30)
        return result, popen.call_args[0][0]

    def test_bounded_command_and_lines(self):
        lines, command = self.read(FakeProc(b"a\nb\n"))
        self.assertEqual(lines, [b"a", b"b"])
        self.assertEqual(command[:8], ["journalctl", "-u", "vodsync.service", "-o", "json", "--no-pager",
                                       "--since", "14 days ago"])

    def test_overflow_failure_and_missing_binary(self):
        with mock.patch.object(ca, "MAX_JOURNAL_BYTES", 3), self.assertRaises(ca.JournalError):
            self.read(FakeProc(b"abcd"))
        with self.assertRaises(ca.JournalError):
            self.read(FakeProc(b"", code=1))
        with mock.patch.object(ca.subprocess, "Popen", side_effect=OSError), self.assertRaises(ca.JournalError):
            ca.read_journal("nope", "u", 1, 30)


if __name__ == "__main__":
    unittest.main()
