"""Offline tests for forward_only.py: the persisted cutoff and the stream-date proof."""
from datetime import datetime, timedelta, timezone
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import forward_only as fo  # noqa: E402

MEXICO = timezone(timedelta(hours=-6))
NOW = datetime(2026, 10, 21, 21, 0, tzinfo=timezone.utc)


class TimeTests(unittest.TestCase):
    def test_default_cutoff_is_oct_21_2200_local(self):
        self.assertEqual(fo.DEFAULT_NOT_BEFORE, "2026-10-22T04:00:00Z")
        self.assertEqual(fo.parse_utc(fo.DEFAULT_NOT_BEFORE).astimezone(MEXICO).isoformat(), "2026-10-21T22:00:00-06:00")

    def test_parse_utc_is_strict(self):
        for bad in ("2026-10-22", "2026-10-22T04:00:00", "2026-10-22T04:00:00+00:00", "2026-13-22T04:00:00Z",
                    "2026-10-22 04:00:00Z", "", None, 5):
            with self.subTest(bad=bad), self.assertRaises(fo.ForwardOnlyError):
                fo.parse_utc(bad)

    def test_stamp_is_the_start_of_the_local_day_in_utc(self):
        self.assertEqual(fo.stamp_earliest_utc("10-22-26", MEXICO), "2026-10-22T06:00:00Z")
        self.assertEqual(fo.stamp_earliest_utc("10-22-26", timezone.utc), "2026-10-22T00:00:00Z")
        for bad in ("10/22/26", "13-01-26", "02-30-26", "1-2-26", "10-22-2026", "", None):
            with self.subTest(bad=bad):
                self.assertIsNone(fo.stamp_earliest_utc(bad, MEXICO))

    def test_stamp_day_spans_one_local_day(self):
        start, end = fo.stamp_day_utc("10-21-26", MEXICO)
        self.assertEqual((fo.format_utc(start), fo.format_utc(end)), ("2026-10-21T06:00:00Z", "2026-10-22T06:00:00Z"))
        mark = fo.parse_utc(fo.DEFAULT_NOT_BEFORE)
        self.assertTrue(start < mark < end)                  # the default cutoff falls inside 10-21-26 local
        self.assertIsNone(fo.stamp_day_utc("02-30-26", MEXICO))
        self.assertEqual(fo.stamp_earliest_utc("10-21-26", MEXICO), "2026-10-21T06:00:00Z")

    def test_local_stamp_matches_vodsyncs_format(self):
        self.assertEqual(fo.local_stamp(datetime(2026, 10, 22, 4, 30, tzinfo=timezone.utc), MEXICO), "10-21-26")
        self.assertEqual(fo.local_stamp(datetime(2026, 10, 22, 6, 0, tzinfo=timezone.utc), MEXICO), "10-22-26")

    def test_is_forward_never_accepts_unknown_dates(self):
        mark = fo.parse_utc(fo.DEFAULT_NOT_BEFORE)
        self.assertTrue(fo.is_forward("2026-10-22T04:00:00Z", mark))
        self.assertFalse(fo.is_forward("2026-10-22T03:59:59Z", mark))
        for unknown in (None, "", "2026-10-22", "garbage", 7):
            self.assertFalse(fo.is_forward(unknown, mark))


class WatermarkTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "state" / "forward-only.json"

    def test_missing_state_is_not_invented_by_a_read(self):
        with self.assertRaises(fo.ForwardOnlyError):
            fo.read_watermark(self.path)
        self.assertFalse(self.path.exists())

    def test_plan_mode_does_not_write(self):
        mark, status = fo.resolve_watermark(self.path, fo.DEFAULT_NOT_BEFORE, NOW, persist=False)
        self.assertEqual((status, fo.format_utc(mark), self.path.exists()), ("initialized", fo.DEFAULT_NOT_BEFORE, False))

    def test_initialize_persists_once_and_is_stable(self):
        fo.resolve_watermark(self.path, fo.DEFAULT_NOT_BEFORE, NOW, persist=True)
        doc = json.loads(self.path.read_text())
        self.assertEqual(doc, {"version": 1, "notBefore": fo.DEFAULT_NOT_BEFORE, "initializedAt": "2026-10-21T21:00:00Z"})
        later = NOW + timedelta(days=30)
        mark, status = fo.resolve_watermark(self.path, fo.DEFAULT_NOT_BEFORE, later, persist=True)
        self.assertEqual((status, json.loads(self.path.read_text())), ("existing", doc))   # a rerun never moves it
        self.assertEqual(fo.read_watermark(self.path), mark)

    def test_lowering_is_refused_and_leaves_the_file_alone(self):
        fo.resolve_watermark(self.path, fo.DEFAULT_NOT_BEFORE, NOW, persist=True)
        before = self.path.read_bytes()
        with self.assertRaises(fo.ForwardOnlyError):
            fo.resolve_watermark(self.path, "2026-10-22T03:59:59Z", NOW, persist=True)
        self.assertEqual(self.path.read_bytes(), before)

    def test_raising_persists_and_keeps_the_initialization_record(self):
        fo.resolve_watermark(self.path, fo.DEFAULT_NOT_BEFORE, NOW, persist=True)
        mark, status = fo.resolve_watermark(self.path, "2026-11-01T00:00:00Z", NOW + timedelta(days=1), persist=True)
        doc = json.loads(self.path.read_text())
        self.assertEqual((status, doc["notBefore"], doc["initializedAt"], doc["raisedAt"]),
                         ("raised", "2026-11-01T00:00:00Z", "2026-10-21T21:00:00Z", "2026-10-22T21:00:00Z"))

    def test_damaged_state_fails_closed(self):
        self.path.parent.mkdir(parents=True)
        for text in ("{", "[]", json.dumps({"version": 2, "notBefore": fo.DEFAULT_NOT_BEFORE}),
                     json.dumps({"version": 1}), json.dumps({"version": 1, "notBefore": "2026-10-22"})):
            self.path.write_text(text)
            with self.subTest(text=text), self.assertRaises(fo.ValidationError):
                fo.resolve_watermark(self.path, fo.DEFAULT_NOT_BEFORE, NOW, persist=True)
            self.assertEqual(self.path.read_text(), text)


if __name__ == "__main__":
    unittest.main()
