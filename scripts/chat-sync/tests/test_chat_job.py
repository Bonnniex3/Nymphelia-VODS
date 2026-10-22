"""Offline tests for chat_job.py: python -I -m unittest discover -s scripts/chat-sync/tests
No network, no ia CLI, no real downloader, no deploy hook: every boundary is injected or patched."""
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import chat_job as cj  # noqa: E402
import chat_sync as cs  # noqa: E402

FIXTURE = HERE / "fixtures" / "td_chat.json"
EMPTY_FIXTURE = HERE / "fixtures" / "td_chat_empty.json"
VOD = "2500000001"
VIDEO = "[10-22-26] nymphelia - a stream.mp4"   # bracket id is NOT the Twitch VOD id
SIDECAR = "[10-22-26] nymphelia - a stream.chat.json"
ITEM = "NYMPHELIA-2026-ASMR-2"
OLD_ITEM = "NYMPHELIA-2026-ASMR"
GAMING_ITEM = "NYMPHELIA-GAMING26"      # nyaphelia: live-recorded, never chat-mapped here
SECRET = "https://hooks.example/deploy/SECRET-TOKEN"


def entry(**kw):
    base = {"twitchVodId": VOD, "iaItem": ITEM, "videoFile": VIDEO, "offsetSeconds": 0}
    base.update(kw)
    return base


def ia_video(name=VIDEO, size=100):
    return {"name": name, "size": str(size), "md5": "0" * 32, "source": "original"}


class Harness(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.work = self.dir / "queue"
        self.files = [ia_video()]          # what the fake Archive metadata currently lists
        self.downloads, self.uploads, self.hooks = [], [], []
        self.upload_error = None
        self.hook_error = None

    # injectable boundaries
    def download(self, mapping, out):
        self.downloads.append(mapping["twitchVodId"])
        raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
        raw["video"]["id"] = mapping["twitchVodId"]
        for comment in raw["comments"]:
            comment["content_id"] = mapping["twitchVodId"]
        raw_path = self.dir / ("raw-" + mapping["twitchVodId"] + ".json")
        raw_path.write_text(json.dumps(raw), encoding="utf-8")
        return cs.sync_chat(mapping["twitchVodId"], mapping["videoFile"], out, normalize_only=raw_path,
                            offset_seconds=mapping["offsetSeconds"], require_messages=True)

    def metadata(self, item):
        return list(self.files)

    def upload(self, item, path):
        self.uploads.append((item, path.name))
        if self.upload_error:
            raise self.upload_error

    def deploy(self):
        self.hooks.append(1)
        if self.hook_error:
            raise self.hook_error

    def queue(self, entries=None, **kw):
        kw.setdefault("deploy", None)
        return cj.run_queue(entries or [entry()], self.work, self.download, self.metadata, self.upload, **kw)

    def sidecar_path(self, vod=VOD):
        return self.work / vod / SIDECAR

    def publish_on_archive(self, vod=VOD):
        payload = self.sidecar_path(vod).read_bytes()
        self.files.append({"name": SIDECAR, "size": str(len(payload)), "md5": hashlib.md5(payload).hexdigest()})

    def row(self, vod=VOD):
        return json.loads((self.work / "chat-state.json").read_text(encoding="utf-8"))["entries"][vod]


class MappingTests(unittest.TestCase):
    def read(self, data):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mapping.json"
            path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
            return cj.read_mapping(path)

    def mapping(self, *entries, version=1):
        return {"version": version, "entries": list(entries)}

    def assertInvalid(self, data):
        with self.assertRaises(cs.ValidationError):
            self.read(data)

    def test_valid_entry_keeps_exact_values_and_ignores_bracket_numbers(self):
        got = self.read(self.mapping(entry(offsetSeconds=-2.5, note="hand verified")))
        self.assertEqual(got, [entry(offsetSeconds=-2.5)])          # nothing derived from "[111111111111]"

    def test_shipped_files(self):
        example = cj.read_mapping(HERE.parent / "mapping.example.json")
        self.assertEqual(example, [])
        self.assertFalse((HERE.parent / "mapping.smizzles.json").exists())     # no Smizzles data in this repo

    def test_structure_and_unknown_keys(self):
        for bad in ("[]", "not json", self.mapping(version=2), {"version": 1}, {"version": 1, "entries": {}},
                    self.mapping("x"), self.mapping(entry(extra=1)), self.mapping(entry(offset=0)),
                    self.mapping(entry(note=5))):
            with self.subTest(bad=bad):
                self.assertInvalid(bad)

    def test_offset_must_be_explicit_and_finite(self):
        missing = entry()
        del missing["offsetSeconds"]
        self.assertInvalid(self.mapping(missing))
        for bad in ("0", True, None, [0]):
            with self.subTest(bad=bad):
                self.assertInvalid(self.mapping(entry(offsetSeconds=bad)))
        for literal in ("NaN", "Infinity", "-Infinity", "1e999"):
            with self.subTest(literal=literal):
                self.assertInvalid('{"version":1,"entries":[{"twitchVodId":"1","iaItem":"%s","videoFile":"a.mp4",'
                                   '"offsetSeconds":%s}]}' % (ITEM, literal))

    def test_vod_id_item_and_video_file_are_exact(self):
        for bad in (entry(twitchVodId=2500000001), entry(twitchVodId="v250"), entry(twitchVodId=""),
                    entry(twitchVodId="12 3"), entry(iaItem="someoneElse"), entry(iaItem=None),
                    entry(videoFile=None), entry(videoFile="dir/a.mp4"), entry(videoFile="..\\a.mp4"),
                    entry(videoFile="a.txt"), entry(videoFile=".mp4"), entry(videoFile="a.chat.json")):
            with self.subTest(bad=bad):
                self.assertInvalid(self.mapping(bad))

    def test_only_nymphelia_asmr_items_by_default_and_configurable(self):
        self.assertInvalid(self.mapping(entry(iaItem=GAMING_ITEM)))                  # nyaphelia gaming item
        self.assertInvalid(self.mapping(entry(iaItem="SmizzlesGaming26")))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "m.json"
            path.write_text(json.dumps(self.mapping(entry(iaItem="NYMPHELIA-2026-ASMR-3"))), encoding="utf-8")
            with self.assertRaises(cs.ValidationError):
                cj.read_mapping(path)
            self.assertEqual(cj.read_mapping(path, {"NYMPHELIA-2026-ASMR-3"})[0]["iaItem"], "NYMPHELIA-2026-ASMR-3")

    def test_earliest_start_is_optional_but_must_be_utc_iso(self):
        self.assertEqual(self.read(self.mapping(entry(earliestStartUtc="2026-10-22T06:00:00Z")))[0]["earliestStartUtc"],
                         "2026-10-22T06:00:00Z")
        for bad in ("2026-10-22", "2026-10-22T06:00:00", "2026-10-22T06:00:00+00:00", 5, None):
            with self.subTest(bad=bad):
                self.assertInvalid(self.mapping(entry(earliestStartUtc=bad)))

    def test_duplicates_and_ambiguous_targets(self):
        self.assertInvalid(self.mapping(entry(), entry(videoFile="other.mp4")))               # same VOD twice
        self.assertInvalid(self.mapping(entry(), entry(twitchVodId="2", videoFile=VIDEO)))     # same file twice
        self.assertInvalid(self.mapping(entry(videoFile="a.mp4"),
                                        entry(twitchVodId="2", videoFile="a.mkv")))            # same stem -> same sidecar
        other_item = self.read(self.mapping(entry(videoFile="a.mp4"),
                                            entry(twitchVodId="2", iaItem=OLD_ITEM, videoFile="a.mp4")))
        self.assertEqual(len(other_item), 2)                                                   # different item is fine


class ArchiveChecksTests(Harness):
    def sidecar_file(self, **kw):
        path = self.dir / SIDECAR
        path.write_bytes(b'{"x": 1}\n')
        digest = hashlib.md5(path.read_bytes()).hexdigest()
        item = {"name": SIDECAR, "size": str(path.stat().st_size), "md5": digest}
        item.update(kw)
        return path, item

    def test_publication_requires_size_and_md5(self):
        path, good = self.sidecar_file()
        self.assertEqual(cj.publication([good], path), "confirmed")
        self.assertEqual(cj.publication([], path), "absent")
        self.assertEqual(cj.publication([ia_video()], path), "absent")
        self.assertEqual(cj.publication([dict(good, md5="f" * 32)], path), "conflict")      # same size, other bytes
        self.assertEqual(cj.publication([dict(good, size="3")], path), "conflict")
        self.assertEqual(cj.publication([dict(good, size="oops")], path), "conflict")
        self.assertEqual(cj.publication([dict(good, size=None)], path), "conflict")
        self.assertEqual(cj.publication([dict(good, md5=None)], path), "conflict")
        self.assertEqual(cj.publication([good, good], path), "conflict")                    # ambiguous, never "confirmed"

    def test_exact_video_pair(self):
        mapping = entry()
        cj.validate_video_pair([ia_video()], mapping)
        for files in ([], [ia_video("other.mp4")], [ia_video(size=0)], [dict(ia_video(), size="bad")],
                      [ia_video(), ia_video(VIDEO[:-4] + ".mkv")],            # a.mp4 + a.mkv share one sidecar name
                      [ia_video(VIDEO.upper())]):                             # case-sensitive
            with self.subTest(files=files), self.assertRaises(cs.ValidationError):
                cj.validate_video_pair(files, mapping)

    def test_archive_files_drops_old_and_deleted(self):
        body = json.dumps({"files": [{"name": "a"}, {"name": "b", "old_version": "true"},
                                     {"name": "c", "deleted": True}, "junk"]}).encode()
        response = mock.MagicMock()
        response.__enter__.return_value = io.BytesIO(body)
        with mock.patch.object(cj.urllib.request, "urlopen", return_value=response):
            self.assertEqual([f["name"] for f in cj.archive_files(ITEM)], ["a"])
        response.__enter__.return_value = io.BytesIO(b'{"nofiles": 1}')
        with mock.patch.object(cj.urllib.request, "urlopen", return_value=response), \
                self.assertRaises(cs.ValidationError):
            cj.archive_files(ITEM)


class UploaderTests(unittest.TestCase):
    def test_upload_command_is_quiet_and_exact(self):
        with mock.patch.object(cj.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            cj.upload_sidecar(ITEM, Path("/q/x.chat.json"), "ia-bin")
        argv = run.call_args.args[0]
        self.assertEqual((argv[:3], argv[-1]), (["ia-bin", "upload", ITEM], "--no-derive"))
        self.assertEqual(Path(argv[3]), Path("/q/x.chat.json"))
        for stream in ("stdout", "stderr", "stdin"):                  # never captures or echoes credentials
            self.assertEqual(run.call_args.kwargs[stream], subprocess.DEVNULL)

    def test_nonzero_exit_raises_without_output(self):
        with mock.patch.object(cj.subprocess, "run", return_value=subprocess.CompletedProcess([], 3)):
            with self.assertRaises(RuntimeError) as ctx:
                cj.upload_sidecar(ITEM, Path("x"))
        self.assertEqual(str(ctx.exception), "Archive uploader exited 3")


class QueueTests(Harness):
    def test_download_only_does_not_touch_archive_or_hook(self):
        state = self.queue()
        self.assertEqual(state["entries"][VOD]["status"], "downloaded")
        self.assertEqual((self.downloads, self.uploads, self.hooks), ([VOD], [], []))
        self.assertTrue(self.sidecar_path().is_file())

    def test_offset_from_mapping_lands_in_sidecar(self):
        self.queue([entry(offsetSeconds=-3.5)])
        self.assertEqual(json.loads(self.sidecar_path().read_text(encoding="utf-8"))["offsetSeconds"], -3.5)

    def test_publish_flow_upload_then_confirm_then_deploy(self):
        first = self.queue(publish=True, deploy=self.deploy)
        self.assertEqual(first["entries"][VOD]["status"], "uploaded")
        self.assertEqual(self.uploads, [(ITEM, SIDECAR)])
        self.assertEqual(self.hooks, [])                       # unpublished: no rebuild yet
        again = self.queue(publish=True, deploy=self.deploy)     # Archive has not exposed it yet
        self.assertEqual(again["entries"][VOD]["status"], "uploaded")
        self.assertEqual((len(self.uploads), self.hooks), (1, []))
        self.publish_on_archive()
        done = self.queue(publish=True, deploy=self.deploy)
        row = done["entries"][VOD]
        self.assertEqual((row["status"], row["needsDeploy"]), ("published", False))
        self.assertEqual((self.downloads, len(self.uploads), len(self.hooks)), ([VOD], 1, 1))

    def test_rerun_after_published_is_a_noop(self):
        self.queue(publish=True)
        self.publish_on_archive()
        self.queue(publish=True, deploy=self.deploy)
        before = (self.work / "chat-state.json").read_bytes()
        self.queue(publish=True, deploy=self.deploy)
        self.assertEqual((self.downloads, len(self.uploads), len(self.hooks)), ([VOD], 1, 1))
        self.assertEqual((self.work / "chat-state.json").read_bytes(), before)

    def test_already_published_identical_bytes_is_adopted_without_upload(self):
        self.queue()
        self.publish_on_archive()
        state = self.queue(publish=True)
        self.assertEqual(state["entries"][VOD]["status"], "published")
        self.assertEqual(self.uploads, [])

    def test_existing_different_sidecar_is_never_overwritten(self):
        self.queue()
        payload = self.sidecar_path().read_bytes()
        self.files.append({"name": SIDECAR, "size": str(len(payload)), "md5": "e" * 32})
        state = self.queue(publish=True)
        row = state["entries"][VOD]
        self.assertEqual((row["status"], row["error"], self.uploads), ("downloaded", {"kind": "validation"}, []))

    def test_explicit_metadata_upgrade_waits_for_old_bytes_without_reupload(self):
        self.queue(publish=True, now=100)
        old = {"name": SIDECAR, "size": "10", "md5": "a" * 32}
        self.files.append(old)
        self.set_row(previousPublication={"size": 10, "md5": "a" * 32})
        row = self.queue(publish=True, now=200)["entries"][VOD]
        self.assertNotIn("error", row)
        self.assertEqual(len(self.uploads), 1)
        self.files.remove(old)
        self.publish_on_archive()
        row = self.queue(publish=True, now=300)["entries"][VOD]
        self.assertEqual(row["status"], "published")
        self.assertNotIn("previousPublication", row)

    def test_metadata_upgrade_still_rejects_unexpected_bytes_and_times_out(self):
        self.queue(publish=True, now=100)
        self.files.append({"name": SIDECAR, "size": "10", "md5": "a" * 32})
        self.set_row(previousPublication={"size": 10, "md5": "b" * 32})
        self.assertIn("error", self.queue(publish=True, now=200)["entries"][VOD])
        self.set_row(previousPublication={"size": 10, "md5": "a" * 32}, nextAttemptAt=0)
        row = self.queue(publish=True, now=100 + cj.UPLOAD_WAIT_SECONDS)["entries"][VOD]
        self.assertIn("error", row)
        self.assertEqual(len(self.uploads), 1)

    def test_video_missing_waits_without_exhausting_retries(self):
        self.files = []
        for now in range(0, 36000, 3600):
            row = self.queue(publish=True, now=now)["entries"][VOD]
            self.assertTrue(row["waitingForVideo"])
            self.assertEqual(row["attempts"], 0)
            self.assertNotIn("error", row)
        self.assertEqual(self.uploads, [])
        self.assertEqual(self.downloads, [VOD])
        self.files = [ia_video()]
        row = self.queue(publish=True, now=40000)["entries"][VOD]
        self.assertEqual(row["status"], "uploaded")
        self.assertNotIn("waitingForVideo", row)
        self.assertEqual(len(self.uploads), 1)

    def test_ambiguous_video_still_blocks_with_error(self):
        self.files = [ia_video(), ia_video(VIDEO[:-4] + ".mkv")]
        row = self.queue(publish=True)["entries"][VOD]
        self.assertEqual(row["error"], {"kind": "validation"})
        self.assertEqual(self.uploads, [])

    def test_state_is_saved_as_uploading_before_the_upload_runs(self):
        seen = []

        def upload(item, path):
            seen.append(self.row()["status"])        # what a crash right here would leave behind
        self.upload = upload
        self.queue(publish=True)
        self.assertEqual(seen, ["uploading"])
        self.assertEqual(self.row()["status"], "uploaded")

    def test_crash_mid_upload_never_uploads_twice(self):
        self.queue(publish=True)
        state_path = self.work / "chat-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["entries"][VOD]["status"] = "uploading"        # as left by a killed process
        state_path.write_text(json.dumps(state), encoding="utf-8")
        self.queue(publish=True)
        self.assertEqual(len(self.uploads), 1)               # waits for Archive instead of re-uploading
        self.assertEqual(self.row()["status"], "uploading")
        self.publish_on_archive()
        self.assertEqual(self.queue(publish=True)["entries"][VOD]["status"], "published")

    def test_unpublished_upload_surfaces_after_a_day(self):
        self.queue(publish=True, now=1000)
        state = self.queue(publish=True, now=1000 + cj.UPLOAD_WAIT_SECONDS - 1)
        self.assertNotIn("error", state["entries"][VOD])
        state = self.queue(publish=True, now=1000 + cj.UPLOAD_WAIT_SECONDS)
        self.assertEqual(state["entries"][VOD]["error"], {"kind": "validation"})
        self.assertEqual(len(self.uploads), 1)

    def set_row(self, **changes):
        path = self.work / "chat-state.json"
        state = json.loads(path.read_text(encoding="utf-8"))
        state["entries"][VOD].update(changes)
        path.write_text(json.dumps(state), encoding="utf-8")

    def test_failed_upload_stays_uncertain_and_is_never_retried_blindly(self):
        for exc in (RuntimeError("ia: access=SECRET-KEY denied"),
                    subprocess.TimeoutExpired(["ia", "SECRET-KEY"], 300), OSError("SECRET-KEY")):
            with self.subTest(exc=type(exc).__name__):
                self.work = self.dir / ("q-" + type(exc).__name__)
                self.uploads.clear()
                self.files = [ia_video()]
                self.upload_error = exc
                row = self.queue(publish=True, now=100, retry_after=60)["entries"][VOD]
                self.assertEqual((row["status"], row["uploadedAt"], row["attempts"], row["nextAttemptAt"]),
                                 ("uploading", 100, 1, 160))
                self.assertEqual(row["error"], {"kind": type(exc).__name__})
                self.assertNotIn("SECRET", (self.work / "chat-state.json").read_text(encoding="utf-8"))
                self.upload_error = None
                for now in (159, 160, 5000):                    # backoff, then plain confirmation checks
                    self.queue(publish=True, now=now, retry_after=60)
                self.assertEqual(len(self.uploads), 1)           # never uploaded again
                self.assertEqual(self.row()["status"], "uploading")
                self.publish_on_archive()
                row = self.queue(publish=True, now=6000, retry_after=60)["entries"][VOD]
                self.assertEqual((row["status"], "error" in row, len(self.uploads)), ("published", False, 1))

    def test_uploader_failure_after_remote_accepted_the_bytes(self):
        def upload(item, path):
            self.uploads.append((item, path.name))
            self.publish_on_archive()                        # Archive accepted it, then ia timed out / crashed
            raise subprocess.TimeoutExpired("ia", 300)
        self.upload = upload
        self.queue(publish=True, now=100, retry_after=60)
        row = self.queue(publish=True, now=200, retry_after=60)["entries"][VOD]
        self.assertEqual((row["status"], len(self.uploads)), ("published", 1))

    def test_interrupt_during_upload_leaves_uploading_on_disk(self):
        def upload(item, path):
            self.uploads.append((item, path.name))
            raise KeyboardInterrupt
        self.upload = upload
        with self.assertRaises(KeyboardInterrupt):
            self.queue(publish=True, now=100)
        self.assertEqual((self.row()["status"], self.row()["uploadedAt"]), ("uploading", 100))
        self.upload = lambda item, path: self.uploads.append((item, path.name))
        self.queue(publish=True, now=200)
        self.assertEqual(len(self.uploads), 1)

    def test_saved_state_before_and_after_upload(self):
        self.queue(publish=True)                                # one real upload, then drop the Archive listing
        self.assertEqual(len(self.uploads), 1)
        # crash after the upload but before "uploaded" was saved -> "uploading": no second upload
        # crash after "uploaded" was saved                       -> "uploaded":  no second upload
        for status in ("uploading", "uploaded"):
            self.set_row(status=status, uploadedAt=0, attempts=0, nextAttemptAt=0)
            self.queue(publish=True, now=60)
            self.assertEqual(len(self.uploads), 1, status)
        # crash before the upload started -> "downloaded" with nothing on the Archive: uploads exactly once
        self.set_row(status="downloaded")
        self.queue(publish=True, now=70)
        self.assertEqual(len(self.uploads), 2)
        self.queue(publish=True, now=80)
        self.assertEqual(len(self.uploads), 2)

    def test_operator_reset_is_the_only_way_to_upload_again(self):
        self.upload_error = RuntimeError("down")
        self.queue(publish=True, now=0, retry_after=1, max_attempts=10)
        self.upload_error = None
        row = self.queue(publish=True, now=cj.UPLOAD_WAIT_SECONDS + 5, retry_after=1,
                         max_attempts=10)["entries"][VOD]
        self.assertEqual((row["status"], row["error"], len(self.uploads)), ("uploading", {"kind": "validation"}, 1))
        self.set_row(status="downloaded", attempts=0, nextAttemptAt=0)    # explicit operator reset
        row = self.queue(publish=True, now=cj.UPLOAD_WAIT_SECONDS + 10)["entries"][VOD]
        self.assertEqual((row["status"], len(self.uploads)), ("uploaded", 2))

    def test_download_failure_retries_then_stops_at_max_attempts(self):
        def failing(mapping, out):
            self.downloads.append("x")
            raise cs.DownloaderError("rate limited token=SECRET")
        self.download = failing
        for tick in range(5):
            self.queue(now=tick * 100, retry_after=10, max_attempts=3)
        row = self.row()
        self.assertEqual((row["status"], row["attempts"], row["error"]), ("pending", 3, {"kind": "downloader"}))
        self.assertEqual(len(self.downloads), 3)
        self.assertNotIn("SECRET", (self.work / "chat-state.json").read_text(encoding="utf-8"))

    def test_unexpected_error_types_are_recorded_not_raised(self):
        for exc in (TypeError("t"), KeyError("k"), cj.http.client.IncompleteRead(b"x"), OSError("o")):
            with self.subTest(exc=type(exc).__name__):
                self.work = self.dir / ("q-" + type(exc).__name__)
                self.metadata = lambda item, exc=exc: (_ for _ in ()).throw(exc)
                state = self.queue(publish=True)
                self.assertEqual(state["entries"][VOD]["attempts"], 1)

    def test_mapping_change_for_queued_vod_is_refused(self):
        self.queue()
        state = self.queue([entry(offsetSeconds=9)], now=10 ** 9)
        self.assertEqual(state["entries"][VOD]["error"], {"kind": "validation"})
        self.assertEqual(state["entries"][VOD]["mapping"]["offsetSeconds"], 0)
        self.assertEqual(json.loads(self.sidecar_path().read_text(encoding="utf-8"))["offsetSeconds"], 0)

    def test_queued_sidecar_must_match_mapping_and_have_messages(self):
        self.queue()
        path = self.sidecar_path()
        doc = json.loads(path.read_text(encoding="utf-8"))
        for label, mutate in (("offset", lambda d: d.update(offsetSeconds=7)),
                              ("empty", lambda d: d.update(messages=[])),
                              ("vod", lambda d: d.update(twitchVodId="9")),
                              ("video", lambda d: d.update(videoFile="other.mp4"))):
            bad = json.loads(json.dumps(doc))
            mutate(bad)
            path.write_text(json.dumps(bad), encoding="utf-8")
            with self.subTest(label):
                state = self.queue(publish=True, now=10 ** 9 * (1 + len(label)))
                self.assertEqual(state["entries"][VOD]["error"], {"kind": "validation"})
                self.assertEqual(self.uploads, [])
        path.unlink()
        self.assertEqual(self.queue(publish=True, now=10 ** 12)["entries"][VOD]["error"], {"kind": "validation"})

    def test_empty_chat_download_is_not_queued(self):
        self.download = lambda m, out: cs.sync_chat(m["twitchVodId"], m["videoFile"], out,
                                                    normalize_only=EMPTY_FIXTURE, require_messages=True)
        row = self.queue()["entries"][VOD]
        self.assertEqual((row["status"], row["error"]), ("pending", {"kind": "validation"}))

    def test_corrupt_state_is_not_replaced(self):
        self.work.mkdir(parents=True)
        for bad in (b"{", b'{"version": 2, "entries": {}}', b'{"version": 1, "entries": {"1": []}}'):
            (self.work / "chat-state.json").write_bytes(bad)
            with self.assertRaises(cs.ValidationError):
                self.queue()
            self.assertEqual((self.work / "chat-state.json").read_bytes(), bad)

    def test_independent_entries_one_failure_does_not_block_other(self):
        second = entry(twitchVodId="2500000002", videoFile="b.mp4")

        def download(mapping, out):
            if mapping["twitchVodId"] == second["twitchVodId"]:
                raise cs.DownloaderError("down")
            return Harness.download(self, mapping, out)
        self.download = download
        state = self.queue([second, entry()])
        self.assertEqual((state["entries"][second["twitchVodId"]]["status"], state["entries"][VOD]["status"]),
                         ("pending", "downloaded"))


class DeployTests(Harness):
    def publish_all(self):
        self.queue(publish=True)
        self.publish_on_archive()

    def test_hook_runs_once_for_a_batch_and_clears_flags(self):
        second = entry(twitchVodId="2500000002", videoFile="b.mp4")
        self.files.append(ia_video("b.mp4"))
        self.queue([entry(), second], publish=True)
        self.publish_on_archive()
        sidecar = self.work / "2500000002" / "b.chat.json"
        self.files.append({"name": "b.chat.json", "size": str(sidecar.stat().st_size),
                           "md5": hashlib.md5(sidecar.read_bytes()).hexdigest()})
        state = self.queue([entry(), second], publish=True, deploy=self.deploy)
        self.assertEqual(len(self.hooks), 1)
        self.assertEqual([r["needsDeploy"] for r in state["entries"].values()], [False, False])

    def test_hook_not_called_before_publication_or_without_new_work(self):
        self.queue(publish=True, deploy=self.deploy)
        self.queue(publish=True, deploy=self.deploy)
        self.assertEqual(self.hooks, [])

    def test_hook_failure_is_retried_without_new_downloads_or_uploads(self):
        self.publish_all()
        self.hook_error = OSError("connect failed " + SECRET)
        state = self.queue(publish=True, deploy=self.deploy)
        self.assertTrue(state["entries"][VOD]["needsDeploy"])
        self.assertEqual(state["deployError"], "deploy hook failed; retry pending")
        self.assertNotIn("SECRET", (self.work / "chat-state.json").read_text(encoding="utf-8"))
        self.hook_error = None
        state = self.queue(publish=True, deploy=self.deploy)
        self.assertEqual((state["entries"][VOD]["needsDeploy"], "deployError" in state), (False, False))
        self.assertEqual((len(self.hooks), len(self.downloads), len(self.uploads)), (2, 1, 1))

    def test_no_hook_configured_keeps_pending_flag_for_later(self):
        self.publish_all()
        state = self.queue(publish=True)
        self.assertTrue(state["entries"][VOD]["needsDeploy"])
        self.queue(publish=True, deploy=self.deploy)
        self.assertEqual(len(self.hooks), 1)

    def test_stale_deploy_error_cleared_when_nothing_pending(self):
        self.queue()
        path = self.work / "chat-state.json"
        state = json.loads(path.read_text(encoding="utf-8"))
        state["deployError"] = "deploy hook failed; retry pending"
        path.write_text(json.dumps(state), encoding="utf-8")
        self.assertNotIn("deployError", self.queue())

    def test_notify_deploy_requires_https_and_posts_empty_body(self):
        with self.assertRaises(cs.ValidationError) as ctx:
            cj.notify_deploy(SECRET.replace("https", "http"))
        self.assertNotIn("SECRET", str(ctx.exception))
        response = mock.MagicMock(status=200)
        response.__enter__.return_value = response
        with mock.patch.object(cj.urllib.request, "urlopen", return_value=response) as urlopen:
            cj.notify_deploy(SECRET)
        request = urlopen.call_args.args[0]
        self.assertEqual((request.get_method(), request.data, request.full_url), ("POST", b"", SECRET))
        response.status = 500
        with mock.patch.object(cj.urllib.request, "urlopen", return_value=response), \
                self.assertRaises(RuntimeError):
            cj.notify_deploy(SECRET)


class LockTests(Harness):
    def test_second_run_is_refused_while_first_holds_lock_then_released(self):
        self.work.mkdir(parents=True)
        with cj.job_lock(self.work / "chat-job.lock"):
            with self.assertRaises(cj.JobBusy):
                self.queue()
            self.assertEqual(self.downloads, [])
        self.assertEqual(self.queue()["entries"][VOD]["status"], "downloaded")


class CliHarness(Harness):
    def call(self, *argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err), mock.patch.dict(cj.os.environ, env or {}):
            code = cj.main(list(argv) if "--forward-state" in argv else [*argv, "--allow-backfill"])
        return code, out.getvalue(), err.getvalue()

    def write_mapping(self, entries=None):
        path = self.dir / "mapping.json"
        path.write_text(json.dumps({"version": 1, "entries": [entry()] if entries is None else entries}),
                        encoding="utf-8")
        return str(path)

class ForwardOnlyQueueTests(CliHarness):
    CUT = "2026-10-22T04:00:00Z"

    def state(self, cutoff=CUT):
        path = self.dir / "forward-only.json"
        path.write_text(json.dumps({"version": 1, "notBefore": cutoff}), encoding="utf-8")
        return str(path)

    def test_old_and_undated_entries_are_never_queued_or_downloaded(self):
        new = entry(earliestStartUtc="2026-10-22T06:00:00Z")
        old = entry(twitchVodId="2", videoFile="[10-21-26] nymphelia - old.mp4", earliestStartUtc="2026-10-21T06:00:00Z")
        undated = entry(twitchVodId="3", videoFile="[10-01-26] nymphelia - undated.mp4")
        mapping = self.write_mapping([old, new, undated])
        code, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", self.state())
        plan = json.loads(out)
        self.assertEqual((code, [e["twitchVodId"] for e in plan["entries"]], plan["excludedBeforeCutoff"]),
                         (0, [VOD], ["2", "3"]))
        downloads = []
        with mock.patch.object(cj, "sync_chat", lambda vod, *a, **k: downloads.append(vod) or (_ for _ in ()).throw(cs.DownloaderError("x"))):
            code, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", self.state(),
                                     "--run")
        self.assertEqual(downloads, [VOD])                    # the old VODs were never even attempted
        self.assertEqual(sorted(json.loads(out)["entries"]), [VOD])
        self.assertEqual(json.loads(out)["excludedBeforeCutoff"], 2)

    def test_exact_start_inside_the_cutoff_day_decides_queue_membership(self):
        evening = entry(earliestStartUtc="2026-10-22T04:30:00Z")
        earlier = entry(twitchVodId="2", videoFile="[10-21-26] nymphelia - earlier.mp4",
                        earliestStartUtc="2026-10-22T03:59:59Z")
        mapping = self.write_mapping([earlier, evening])
        _, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", self.state())
        plan = json.loads(out)
        self.assertEqual(([e["twitchVodId"] for e in plan["entries"]], plan["excludedBeforeCutoff"]), ([VOD], ["2"]))

    def test_cutoff_boundary_is_inclusive(self):
        mapping = self.write_mapping([entry(earliestStartUtc=self.CUT)])
        _, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", self.state())
        self.assertEqual(json.loads(out)["excludedBeforeCutoff"], [])
        _, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work),
                              "--forward-state", self.state("2026-10-22T04:00:01Z"))
        self.assertEqual(json.loads(out)["excludedBeforeCutoff"], [VOD])

    def test_missing_or_damaged_state_fails_closed(self):
        mapping = self.write_mapping([entry(earliestStartUtc="2026-10-22T06:00:00Z")])
        damaged = self.dir / "damaged.json"
        damaged.write_text("{", encoding="utf-8")
        for state in (str(self.dir / "absent.json"), str(damaged)):
            with self.subTest(state=state), mock.patch.object(cj, "run_queue") as run:
                code, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", state, "--run")
                self.assertEqual((code, json.loads(out)["status"], run.called), (1, "error", False))
        self.assertFalse((self.dir / "absent.json").exists())      # chat_job never invents a cutoff

    def test_allowed_items_flag_replaces_the_default(self):
        mapping = self.write_mapping([entry(iaItem="NYMPHELIA-2026-ASMR-3", earliestStartUtc="2026-10-22T06:00:00Z")])
        code, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", self.state())
        self.assertEqual((code, json.loads(out)["status"]), (1, "error"))
        code, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", self.state(),
                                 "--allowed-item", "NYMPHELIA-2026-ASMR-3")
        self.assertEqual(code, 0)


class CliTests(CliHarness):
    def test_default_is_a_read_only_plan(self):
        with mock.patch.object(cj, "run_queue") as run, mock.patch.object(cj, "archive_files") as archive:
            code, out, _ = self.call("--mapping", self.write_mapping(), "--work-dir", str(self.work))
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"mode": "plan", "entries": [entry()], "excludedBeforeCutoff": [],
                                           "quarantined": [], "heldMappings": []})
        self.assertFalse(run.called or archive.called)
        self.assertFalse(self.work.exists())

    def test_a_forward_decision_is_required(self):
        mapping = self.write_mapping()
        for extra in ([], ["--forward-state", "x", "--allow-backfill"]):
            with self.subTest(extra=extra), mock.patch.object(cj, "run_queue") as run:
                out = io.StringIO()
                with redirect_stdout(out):
                    code = cj.main(["--mapping", mapping, "--work-dir", str(self.work), "--run", *extra])
                self.assertEqual((code, json.loads(out.getvalue())["status"], run.called), (1, "error", False))
        self.assertFalse(self.work.exists())


    def test_invalid_mapping_exits_nonzero_without_running(self):
        bad = self.write_mapping([entry(offsetSeconds="0")])
        with mock.patch.object(cj, "run_queue") as run:
            code, out, _ = self.call("--mapping", bad, "--work-dir", str(self.work), "--run")
        self.assertEqual((code, json.loads(out)["kind"], run.called), (1, "validation", False))

    def test_publish_and_hook_flags_need_run_and_publish(self):
        base = ["--mapping", self.write_mapping(), "--work-dir", str(self.work)]
        env = {"CHAT_HOOK": SECRET}
        for extra in (["--publish"], ["--deploy-hook-env", "CHAT_HOOK"], ["--run", "--deploy-hook-env", "CHAT_HOOK"]):
            with self.subTest(extra=extra), mock.patch.object(cj, "run_queue") as run:
                code, out, _ = self.call(*base, *extra, env=env)
                self.assertEqual((code, json.loads(out)["status"], run.called), (1, "error", False))
        self.assertFalse(self.work.exists())

    def test_missing_hook_variable_is_refused(self):
        code, out, _ = self.call("--mapping", self.write_mapping(), "--work-dir", str(self.work), "--run",
                                 "--publish", "--deploy-hook-env", "CHAT_NO_SUCH_HOOK_VAR")
        self.assertEqual((code, json.loads(out)["kind"]), (1, "validation"))

    def test_run_wires_explicit_offset_and_hides_the_hook_secret(self):
        mapping = self.write_mapping([entry(offsetSeconds=1.5)])
        captured = {}

        def fake_sync(vod, video, out, **kw):
            captured.update(vod=vod, video=video, **kw)
            return Harness.download(self, entry(offsetSeconds=kw["offset_seconds"]), out)
        with mock.patch.object(cj, "sync_chat", fake_sync), \
                mock.patch.object(cj, "archive_files", self.metadata), \
                mock.patch.object(cj, "upload_sidecar", lambda item, path, command: self.upload(item, path)), \
                mock.patch.object(cj, "notify_deploy", lambda url: self.hooks.append(url)):
            code, out, err = self.call("--mapping", mapping, "--work-dir", str(self.work), "--run", "--publish",
                                       "--deploy-hook-env", "CHAT_HOOK", "--downloader", "dl-bin",
                                       env={"CHAT_HOOK": SECRET})
            self.assertEqual(code, 0)
            self.publish_on_archive()
            code, out, err = self.call("--mapping", mapping, "--work-dir", str(self.work), "--run", "--publish",
                                       "--deploy-hook-env", "CHAT_HOOK", env={"CHAT_HOOK": SECRET})
        self.assertEqual(code, 0)
        self.assertEqual((captured["offset_seconds"], captured["require_messages"], captured["downloader"]),
                         (1.5, True, ["dl-bin"]))
        self.assertEqual(self.hooks, [SECRET])
        self.assertEqual(json.loads(out)["entries"][VOD]["status"], "published")
        self.assertFalse(json.loads(out)["deployPending"])
        self.assertNotIn("SECRET", out + err + (self.work / "chat-state.json").read_text(encoding="utf-8"))

    def test_error_exit_code_and_busy_lock(self):
        mapping = self.write_mapping()
        with mock.patch.object(cj, "sync_chat", side_effect=cs.DownloaderError("down")):
            code, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--run")
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)["entries"][VOD]["error"], {"kind": "downloader"})
        with cj.job_lock(self.work / "chat-job.lock"):
            code, out, _ = self.call("--mapping", mapping, "--work-dir", str(self.work), "--run")
        self.assertEqual((code, json.loads(out)), (0, {"status": "busy"}))


STEM = VIDEO.rsplit(".", 1)[0]


def quarantine_record(ids=(VOD, "2500000002"), **extra):
    return {"iaItem": ITEM, "stem": STEM, "twitchVodIds": list(ids), "detectedAt": "2026-10-22T05:00:00Z", **extra}


class QuarantineFileTests(unittest.TestCase):
    def read(self, data):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / cj.QUARANTINE_NAME
            path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
            return cj.read_quarantine(path)

    def test_missing_file_quarantines_nothing_and_roundtrips(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / cj.QUARANTINE_NAME
            self.assertEqual(cj.read_quarantine(path), {})
            record = quarantine_record(keepTwitchVodId=VOD, resolvedAt="2026-10-22T06:00:00Z")
            cj.save_quarantine(path, {(ITEM, STEM): record})
            self.assertEqual(cj.read_quarantine(path), {(ITEM, STEM): record})

    def test_malformed_quarantine_fails_closed(self):
        good = quarantine_record()
        bad_documents = ["not json", "[]", {"version": 2, "targets": []}, {"version": 1}, {"version": 1, "targets": {}},
                         {"version": 1, "targets": ["x"]},
                         {"version": 1, "targets": [{"iaItem": ITEM, "stem": STEM}]},
                         {"version": 1, "targets": [dict(good, extra=1)]},
                         {"version": 1, "targets": [dict(good, iaItem="")]},
                         {"version": 1, "targets": [dict(good, stem=5)]},
                         {"version": 1, "targets": [dict(good, twitchVodIds=[])]},
                         {"version": 1, "targets": [dict(good, twitchVodIds=["1", "1"])]},
                         {"version": 1, "targets": [dict(good, twitchVodIds=["abc"])]},
                         {"version": 1, "targets": [dict(good, detectedAt="yesterday")]},
                         {"version": 1, "targets": [dict(good, keepTwitchVodId="999")]},
                         {"version": 1, "targets": [good, dict(good, twitchVodIds=["7"])]}]
        for data in bad_documents:
            with self.subTest(data=data), self.assertRaises(cs.ValidationError):
                self.read(data)

    def test_directory_in_place_of_the_file_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / cj.QUARANTINE_NAME).mkdir()
            with self.assertRaises(OSError):
                cj.read_quarantine(Path(tmp) / cj.QUARANTINE_NAME)


class QuarantineQueueTests(Harness):
    def setUp(self):
        super().setUp()
        self.quarantine = {(ITEM, STEM): quarantine_record()}
        self.metadata_calls = []
        real_metadata = self.metadata
        self.metadata = lambda item: self.metadata_calls.append(item) or real_metadata(item)

    def set_row(self, **changes):
        path = self.work / "chat-state.json"
        state = json.loads(path.read_text(encoding="utf-8"))
        state["entries"][VOD].update(changes)
        path.write_text(json.dumps(state), encoding="utf-8")

    def test_pending_target_is_never_downloaded(self):
        state = self.queue(publish=True, quarantine=self.quarantine, deploy=self.deploy)
        self.assertEqual((self.downloads, self.metadata_calls, self.uploads, self.hooks), ([], [], [], []))
        self.assertEqual(state["entries"], {})

    def test_downloaded_and_uncertain_uploads_are_frozen(self):
        self.queue(publish=True)
        self.assertEqual(len(self.uploads), 1)
        for status in ("downloaded", "uploading", "uploaded"):
            with self.subTest(status=status):
                self.set_row(status=status, uploadedAt=0, attempts=0, nextAttemptAt=0)
                before = (self.work / "chat-state.json").read_bytes()
                self.publish_on_archive()
                calls = len(self.metadata_calls)
                state = self.queue(publish=True, now=60, quarantine=self.quarantine, deploy=self.deploy)
                self.assertEqual((len(self.uploads), len(self.metadata_calls), self.hooks, len(self.downloads)),
                                 (1, calls, [], 1))
                self.assertEqual(state["entries"][VOD]["status"], status)
                self.assertEqual((self.work / "chat-state.json").read_bytes(), before)
                self.files = [ia_video()]

    def test_published_target_does_not_notify_deploy_until_released(self):
        self.queue(publish=True)
        self.publish_on_archive()
        self.queue(publish=True)
        self.assertTrue(self.row()["needsDeploy"])
        state = self.queue(publish=True, quarantine=self.quarantine, deploy=self.deploy)
        self.assertEqual((self.hooks, state["entries"][VOD]["needsDeploy"]), ([], True))
        self.queue(publish=True, deploy=self.deploy)
        self.assertEqual((len(self.hooks), self.row()["needsDeploy"]), (1, False))

    def publish_unrelated_target(self):
        other = entry(twitchVodId="2", videoFile="[10-22-26] nymphelia - other.mp4")
        self.files.append(ia_video(other["videoFile"]))
        self.queue([entry(), other], publish=True)
        payload = (self.work / "2" / "[10-22-26] nymphelia - other.chat.json").read_bytes()
        self.files.append({"name": "[10-22-26] nymphelia - other.chat.json", "size": str(len(payload)),
                           "md5": hashlib.md5(payload).hexdigest()})
        return other

    def test_other_targets_continue_but_the_global_deploy_stays_gated(self):
        other = self.publish_unrelated_target()
        self.queue([entry(), other], publish=True, quarantine=self.quarantine, deploy=self.deploy)
        self.assertEqual(self.hooks, [])
        self.assertEqual((self.row("2")["status"], self.row("2")["needsDeploy"]), ("published", True))
        self.assertEqual((self.row()["status"], len(self.uploads)), ("uploaded", 2))

    def test_deploy_resumes_for_every_published_target_once_the_quarantine_is_resolved(self):
        other = self.publish_unrelated_target()
        self.queue([entry(), other], publish=True, quarantine=self.quarantine, deploy=self.deploy)
        self.queue([entry(), other], publish=True, quarantine=self.quarantine, deploy=self.deploy)
        self.assertEqual(self.hooks, [])
        self.publish_on_archive()
        record = quarantine_record(keepTwitchVodId=VOD, resolvedAt="2026-10-22T06:00:00Z")
        state = self.queue([entry(), other], publish=True, quarantine={(ITEM, STEM): record}, deploy=self.deploy)
        self.assertEqual(len(self.hooks), 1)
        self.assertEqual([state["entries"][vod]["needsDeploy"] for vod in (VOD, "2")], [False, False])
        self.assertEqual(len(self.uploads), 2)

    def test_a_held_and_a_safe_published_target_both_keep_their_flags_until_release(self):
        other = self.publish_unrelated_target()
        self.queue([entry(), other], publish=True)
        self.publish_on_archive()
        self.queue([entry()], publish=True)
        self.assertTrue(self.row()["needsDeploy"])
        state = self.queue([entry(), other], publish=True, quarantine=self.quarantine, deploy=self.deploy)
        self.assertEqual(self.hooks, [])
        self.assertEqual([state["entries"][vod]["needsDeploy"] for vod in (VOD, "2")], [True, True])
        self.queue([entry(), other], publish=True, deploy=self.deploy)
        self.assertEqual(len(self.hooks), 1)
        self.assertEqual([self.row(vod)["needsDeploy"] for vod in (VOD, "2")], [False, False])

    def test_only_the_resolved_keeper_may_pass(self):
        record = quarantine_record(keepTwitchVodId=VOD, resolvedAt="2026-10-22T06:00:00Z")
        loser = entry(twitchVodId="2500000002")
        state = self.queue([entry(), loser], quarantine={(ITEM, STEM): record})
        self.assertEqual(sorted(state["entries"]), [VOD])
        self.assertEqual(self.downloads, [VOD])

    def test_row_without_a_mapping_is_not_deployed_while_anything_is_quarantined(self):
        path = self.work / "chat-state.json"
        self.work.mkdir(parents=True)
        path.write_text(json.dumps({"version": 1, "entries": {"9": {"status": "published", "needsDeploy": True}}}),
                        encoding="utf-8")
        self.queue([], publish=True, quarantine=self.quarantine, deploy=self.deploy)
        self.assertEqual(self.hooks, [])
        self.queue([], publish=True, deploy=self.deploy)
        self.assertEqual(len(self.hooks), 1)


class QuarantineCliTests(CliHarness):
    def write_quarantine(self, content=None):
        path = self.dir / cj.QUARANTINE_NAME
        path.write_text(content if isinstance(content, str) else
                        json.dumps({"version": 1, "targets": [quarantine_record()] if content is None else content}),
                        encoding="utf-8")

    def run_job(self, *extra):
        mapping = self.write_mapping([entry(earliestStartUtc="2026-10-22T06:00:00Z")])
        state = self.dir / "forward-only.json"
        state.write_text(json.dumps({"version": 1, "notBefore": "2026-10-22T04:00:00Z"}), encoding="utf-8")
        with mock.patch.object(cj, "sync_chat") as sync, mock.patch.object(cj, "archive_files") as archive, \
                mock.patch.object(cj, "upload_sidecar") as upload, mock.patch.object(cj, "notify_deploy") as deploy:
            result = self.call("--mapping", mapping, "--work-dir", str(self.work), "--forward-state", str(state),
                               *extra, env={"CHAT_HOOK": SECRET})
        return result, (sync, archive, upload, deploy)

    def test_persisted_conflict_is_enforced_by_a_direct_job_run(self):
        self.write_quarantine()
        (code, out, _), boundaries = self.run_job("--run", "--publish", "--deploy-hook-env", "CHAT_HOOK")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["quarantined"], [VOD])
        self.assertEqual(json.loads(out)["entries"], {})
        for boundary in boundaries:
            boundary.assert_not_called()

    def test_plan_shows_the_persisted_blocks(self):
        self.write_quarantine()
        (code, out, _), _ = self.run_job()
        plan = json.loads(out)
        self.assertEqual((code, plan["entries"], plan["heldMappings"], plan["quarantined"]),
                         (0, [], [VOD], [quarantine_record()]))

    def test_global_deploy_gate_is_reported_and_the_hook_is_not_called(self):
        self.write_quarantine()
        self.work.mkdir(parents=True)
        state = {"version": 1, "entries": {"9": {"status": "published", "needsDeploy": True,
                                                  "mapping": entry(twitchVodId="9", videoFile="[10-22-26] nymphelia - c.mp4")}}}
        (self.work / "chat-state.json").write_text(json.dumps(state), encoding="utf-8")
        (code, out, _), boundaries = self.run_job("--run", "--publish", "--deploy-hook-env", "CHAT_HOOK")
        report = json.loads(out)
        self.assertEqual((code, report["deployPending"], report["deployGated"], report["warnings"]),
                         (0, True, True, ["deploy_gated_by_quarantine"]))
        self.assertEqual(report["entries"]["9"]["needsDeploy"], True)
        for boundary in boundaries:
            boundary.assert_not_called()

    def test_no_gate_is_reported_without_a_pending_deploy(self):
        self.write_quarantine()
        (code, out, _), _ = self.run_job("--run", "--publish")
        report = json.loads(out)
        self.assertEqual((code, report["deployPending"], report["deployGated"], report["warnings"]), (0, False, False, []))

    def test_malformed_quarantine_blocks_the_whole_run(self):
        for content in ("{", json.dumps({"version": 1, "targets": "x"})):
            with self.subTest(content=content):
                self.write_quarantine(content)
                (code, out, _), boundaries = self.run_job("--run", "--publish")
                self.assertEqual((code, json.loads(out)["status"]), (1, "error"))
                for boundary in boundaries:
                    boundary.assert_not_called()

    def test_run_holds_the_mapping_lock_so_a_concurrent_writer_waits(self):
        seen = []

        def spy(*args, **kwargs):
            try:
                with cj.job_lock(cj.mapping_lock_path(self.dir / "mapping.json")):
                    seen.append("free")
            except cj.JobBusy:
                seen.append("held")
            return {"version": 1, "entries": {}}
        with mock.patch.object(cj, "run_queue", spy):
            self.run_job("--run")
        self.assertEqual(seen, ["held"])


class SidecarSizeTests(Harness):
    def setUp(self):
        super().setUp()
        self.metadata_calls = []
        real_metadata = self.metadata
        self.metadata = lambda item: self.metadata_calls.append(item) or real_metadata(item)

    def test_fresh_download_is_not_affected_by_the_default_limit(self):
        self.queue(publish=True)
        self.assertEqual((len(self.uploads), len(self.metadata_calls)), (1, 1))

    def test_oversized_cached_sidecar_never_reaches_archive_upload_or_deploy(self):
        self.queue()
        path = self.work / "chat-state.json"
        for status in ("downloaded", "uploading"):
            with self.subTest(status=status):
                state = json.loads(path.read_text(encoding="utf-8"))
                state["entries"][VOD].update(status=status, uploadedAt=0, attempts=0, nextAttemptAt=0)
                path.write_text(json.dumps(state), encoding="utf-8")
                size = self.sidecar_path().stat().st_size
                with mock.patch.object(cs, "MAX_SIDECAR_BYTES", size - 1):
                    row = self.queue(publish=True, now=60, deploy=self.deploy)["entries"][VOD]
                self.assertEqual((row["status"], row["error"], row["attempts"]), (status, {"kind": "validation"}, 1))
                self.assertEqual((self.metadata_calls, self.uploads, self.hooks), ([], [], []))

    def test_sidecar_exactly_at_the_limit_is_accepted(self):
        self.queue()
        with mock.patch.object(cs, "MAX_SIDECAR_BYTES", self.sidecar_path().stat().st_size):
            row = self.queue(publish=True)["entries"][VOD]
        self.assertEqual((row["status"], len(self.uploads)), ("uploaded", 1))

    def test_size_is_checked_before_the_file_is_read(self):
        self.queue()
        read = []
        real_read_bytes = Path.read_bytes

        def spy(path):
            read.append(path.name)
            return real_read_bytes(path)
        with mock.patch.object(cs, "MAX_SIDECAR_BYTES", 1), mock.patch.object(Path, "read_bytes", spy):
            row = self.queue(publish=True)["entries"][VOD]
        self.assertEqual(row["error"], {"kind": "validation"})
        self.assertNotIn(SIDECAR, read)


if __name__ == "__main__":
    unittest.main()
