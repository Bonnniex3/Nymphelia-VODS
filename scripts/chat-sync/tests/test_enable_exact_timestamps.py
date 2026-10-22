"""Offline tests for enable-exact-timestamps.py: temp files only, never a real vodsync.py or a remote machine."""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import logging
import os
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import chat_auto as ca  # noqa: E402
import forward_only as fo  # noqa: E402

spec = importlib.util.spec_from_file_location("enable_exact_timestamps", HERE.parent / "enable-exact-timestamps.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

SAMPLE = '''import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger("vodsync")


def sync(vods, stamp):
    for v in vods:
        log.info("  VOD %s  [%s] %s", v["id"], stamp, v["title"][:60])
        log.info("    routed to %s", "NYMPHELIA-2026-ASMR-2")
        log.info("    downloading + remuxing -> %s", "x.mp4")
'''
LINE = '        log.info("    source published at %s", v["published"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))'


def patched_sample(text=SAMPLE, newline="\n"):
    anchor = '        log.info("  VOD %s  [%s] %s", v["id"], stamp, v["title"][:60])'
    return text.replace(anchor, anchor + newline + LINE, 1)


class HelperCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.target = self.dir / "vodsync.py"

    def write(self, text=SAMPLE, newline=None):
        data = text.encode("utf-8") if isinstance(text, str) else text
        if newline:
            data = data.replace(b"\n", newline.encode())
        self.target.write_bytes(data)
        return data

    def run_helper(self, *flags, target=None):
        out = io.StringIO()
        with redirect_stdout(out):
            code = helper.run(["--target", str(target or self.target), *flags])
        return code, json.loads(out.getvalue())

    def files(self):
        return sorted(p.name for p in self.dir.iterdir())


class PatchTests(HelperCase):
    def test_dry_run_is_the_default_and_writes_nothing(self):
        original = self.write()
        code, out = self.run_helper()
        self.assertEqual((code, out["state"], out["applied"]), (0, "patched", False))
        self.assertEqual((self.target.read_bytes(), self.files()), (original, ["vodsync.py"]))

    def test_apply_inserts_exactly_one_line_after_the_anchor_with_a_backup(self):
        original = self.write()
        code, out = self.run_helper("--apply")
        self.assertEqual((code, out["state"], out["applied"]), (0, "patched", True))
        self.assertEqual(self.target.read_text(encoding="utf-8"), patched_sample())
        backup = Path(out["backup"])
        self.assertEqual((backup.read_bytes(), backup.parent), (original, self.dir))
        self.assertEqual(self.files(), sorted(["vodsync.py", backup.name]))     # no temp file left behind
        self.assertEqual(out["sha256Before"], hashlib.sha256(original).hexdigest())
        self.assertEqual(out["sha256After"], hashlib.sha256(self.target.read_bytes()).hexdigest())
        compile(self.target.read_text(encoding="utf-8"), "vodsync.py", "exec")

    @unittest.skipIf(os.name == "nt", "POSIX permission bits")
    def test_permissions_are_preserved(self):
        self.write()
        self.target.chmod(0o640)
        self.run_helper("--apply")
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o640)

    def test_crlf_files_keep_their_line_endings(self):
        original = self.write(newline="\r\n")
        code, out = self.run_helper("--apply")
        self.assertEqual(code, 0)
        self.assertEqual(self.target.read_bytes(), patched_sample().encode().replace(b"\n", b"\r\n"))
        self.assertEqual(Path(out["backup"]).read_bytes(), original)
        self.assertEqual(self.target.read_bytes().count(b"\n"), self.target.read_bytes().count(b"\r\n"))

    def test_running_twice_is_a_no_op(self):
        self.write()
        self.run_helper("--apply")
        patched = self.target.read_bytes()
        code, out = self.run_helper("--apply")
        self.assertEqual((code, out["state"], out["applied"], self.target.read_bytes()), (0, "already", False, patched))
        self.assertEqual(len(self.files()), 2)                                  # still one backup, from the first run

    def test_existing_backup_is_preserved_and_target_untouched_on_collision(self):
        original = self.write()
        existing = self.dir / "vodsync.py.bak-exact-ts-20261021T000000Z"
        existing.write_bytes(b"an earlier backup\n")
        with self.assertRaises(FileExistsError):
            helper.atomic_write(self.target, b"patched\n", "20261021T000000Z")
        self.assertEqual(existing.read_bytes(), b"an earlier backup\n")
        self.assertEqual(self.target.read_bytes(), original)
        self.assertEqual(self.files(), sorted(["vodsync.py", existing.name]))   # no temp file left behind

    def test_apply_reports_error_and_changes_nothing_when_the_backup_name_is_taken(self):
        original = self.write()
        existing = self.dir / "vodsync.py.bak-exact-ts-20261021T000000Z"
        existing.write_bytes(b"an earlier backup\n")
        fixed = datetime(2026, 10, 21, 0, 0, 0, tzinfo=timezone.utc)
        with mock.patch.object(helper, "datetime") as fake_datetime:
            fake_datetime.now.return_value = fixed
            code, out = self.run_helper("--apply")
        self.assertEqual((code, out["state"], out["reason"], out["applied"]), (1, "error", "FileExistsError", False))
        self.assertEqual((existing.read_bytes(), self.target.read_bytes()), (b"an earlier backup\n", original))
        self.assertEqual(self.files(), sorted(["vodsync.py", existing.name]))

    def test_backup_is_an_exact_copy_with_the_targets_mode(self):
        original = self.write()
        self.target.chmod(0o600)
        backup = helper.atomic_write(self.target, b"patched\n", "20261021T000001Z")
        self.assertEqual(backup.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), stat.S_IMODE(self.dir.joinpath("vodsync.py").stat().st_mode))

    def test_matching_sha_guard_allows_the_patch(self):
        original = self.write()
        good = hashlib.sha256(original).hexdigest()
        self.assertEqual(self.run_helper("--apply", "--expect-sha256", good.upper())[0], 0)

    def test_inserted_line_runs_and_the_chat_parser_accepts_what_it_logs(self):
        self.write()
        self.run_helper("--apply")
        namespace = {}
        exec(compile(self.target.read_text(encoding="utf-8"), "vodsync.py", "exec"), namespace)
        messages = []

        class Capture(logging.Handler):
            def emit(self, record):
                messages.append(record.getMessage())
        handler = Capture()
        namespace["log"].addHandler(handler)
        namespace["log"].setLevel(logging.INFO)
        try:
            tonight = datetime(2026, 10, 22, 4, 30, tzinfo=timezone.utc)
            namespace["sync"]([{"id": "2900000001", "title": "tonight", "published": tonight}], "10-21-26")
        finally:
            namespace["log"].removeHandler(handler)
        self.assertEqual(messages, ["  VOD 2900000001  [10-21-26] tonight",
                                    "    source published at 2026-10-22T04:30:00Z",
                                    "    routed to NYMPHELIA-2026-ASMR-2",
                                    "    downloading + remuxing -> x.mp4"])
        # feed exactly those lines to chat_auto: the same-day post-cutoff stream is qualified by its exact start
        records = [{"MESSAGE": m, "_SYSTEMD_INVOCATION_ID": "a" * 32} for m in ["=== nymphelia ==="] + messages]
        policy = ca.Policy({"NYMPHELIA-2026-ASMR-2"}, timezone(timedelta(hours=-6)), fo.parse_utc(fo.DEFAULT_NOT_BEFORE))
        name = "x.mp4"
        self.assertEqual(ca.derive_entries(records, policy),
                         [{"twitchVodId": "2900000001", "iaItem": "NYMPHELIA-2026-ASMR-2", "videoFile": name,
                           "offsetSeconds": 0, "earliestStartUtc": "2026-10-22T04:30:00Z"}])

    def test_a_non_utc_published_value_is_logged_in_utc(self):
        self.write()
        self.run_helper("--apply")
        namespace = {}
        exec(compile(self.target.read_text(encoding="utf-8"), "vodsync.py", "exec"), namespace)
        messages = []

        class Capture(logging.Handler):
            def emit(self, record):
                messages.append(record.getMessage())
        handler = Capture()
        namespace["log"].addHandler(handler)
        namespace["log"].setLevel(logging.INFO)
        try:
            local = datetime(2026, 10, 21, 22, 30, tzinfo=timezone(timedelta(hours=-6)))
            namespace["sync"]([{"id": "1", "title": "t", "published": local}], "10-21-26")
        finally:
            namespace["log"].removeHandler(handler)
        self.assertIn("    source published at 2026-10-22T04:30:00Z", messages)


class RefusalTests(HelperCase):
    def refuses(self, original, *flags):
        code, out = self.run_helper("--apply", *flags)
        self.assertEqual((code, out["state"], out["applied"]), (2, "refused", False))
        self.assertEqual((self.target.read_bytes(), self.files()), (original, ["vodsync.py"]))    # untouched, no backup
        return out["reason"]

    def test_anchor_missing_or_changed(self):
        changed = SAMPLE.replace('stamp, v["title"][:60]', 'stamp, v["title"][:70]')
        for text in (changed, SAMPLE.replace("  VOD %s", " VOD %s"), "import logging\nfrom datetime import timezone\n"):
            with self.subTest(text=text[:40]):
                self.assertIn("found 0", self.refuses(self.write(text)))

    def test_anchor_more_than_once(self):
        doubled = SAMPLE + "\n" + SAMPLE.split("\n\n\n")[1].replace("def sync", "def sync2")
        self.assertIn("found 2", self.refuses(self.write(doubled)))

    def test_timezone_import_is_required_and_never_added(self):
        for header in ("from datetime import datetime, timedelta", "import datetime", "from datetime import timezone as tz",
                       "from other import timezone"):
            with self.subTest(header=header):
                text = SAMPLE.replace("from datetime import datetime, timedelta, timezone", header)
                self.assertIn("timezone", self.refuses(self.write(text)))

    def test_source_that_does_not_compile_or_decode(self):
        self.refuses(self.write(SAMPLE + "def broken(:\n"))
        self.assertIn("UTF-8", self.refuses(self.write(SAMPLE.encode() + b"\n# \xff\xfe\n")))

    def test_line_present_somewhere_else_is_not_duplicated(self):
        other = SAMPLE + "\n\n" + LINE.replace("        ", "", 1) + "\n"
        self.assertIn("already exists", self.refuses(self.write(other)))

    def test_sha_mismatch(self):
        self.assertIn("SHA-256", self.refuses(self.write(), "--expect-sha256", "0" * 64))

    def test_missing_or_non_regular_target(self):
        code, out = self.run_helper("--apply", target=self.dir / "absent.py")
        self.assertEqual((code, out["state"]), (2, "refused"))
        code, out = self.run_helper("--apply", target=self.dir)
        self.assertEqual((code, out["state"]), (2, "refused"))

    def test_symlink_is_refused(self):
        real = self.dir / "real.py"
        real.write_text(SAMPLE, encoding="utf-8")
        link = self.dir / "link.py"
        try:
            link.symlink_to(real)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        code, out = self.run_helper("--apply", target=link)
        self.assertEqual((code, out["state"]), (2, "refused"))
        self.assertEqual(real.read_text(encoding="utf-8"), SAMPLE)

    def test_patch_source_returns_without_touching_disk(self):
        text, state = helper.patch_source(SAMPLE)
        self.assertEqual((state, text), ("patched", patched_sample()))
        self.assertEqual(helper.patch_source(text), (text, "already"))


if __name__ == "__main__":
    unittest.main()
