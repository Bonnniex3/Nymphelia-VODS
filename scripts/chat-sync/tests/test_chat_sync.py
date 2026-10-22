"""Offline tests: python -I -m unittest discover -s scripts/chat-sync/tests  (no network, no real downloader)."""
import base64
import copy
import gzip
import io
import json
import os
import re
import struct
import sys
import tempfile
import unittest
import zlib
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import chat_sync as cs  # noqa: E402

FIXTURE = HERE / "fixtures" / "td_chat.json"
EMPTY_FIXTURE = HERE / "fixtures" / "td_chat_empty.json"
FAKE = HERE / "fake_downloader.py"
BADGE_FIXTURE = HERE / "fixtures" / "td_chat_badges.json"
BADGE_VOD = "2500000002"
VOD = "2500000001"
VIDEO = "[10-1-26] smizzles - Dots. in title.mp4"
EMOTE_25 = "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0"


def fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class TempDirCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        self.out = self.dir / "out"
        self.sidecar = self.out / "[10-1-26] smizzles - Dots. in title.chat.json"

    def write_raw(self, obj, name="raw.json"):
        path = self.dir / name
        path.write_text(json.dumps(obj), encoding="utf-8")
        return path

    def normalize(self, raw_path, **kw):
        return cs.sync_chat(kw.pop("vod", VOD), kw.pop("video", VIDEO), self.out,
                            normalize_only=raw_path, **kw)

    def leftovers(self):
        return sorted(p.name for p in self.out.iterdir()) if self.out.exists() else []


class NormalizeTests(TempDirCase):
    def test_sidecar_name_is_exact_video_stem(self):
        self.normalize(FIXTURE)
        self.assertEqual(self.leftovers(), ["[10-1-26] smizzles - Dots. in title.chat.json"])

    def test_schema_utf8_sorting_duplicates_and_subseconds(self):
        result = self.normalize(FIXTURE)
        data = json.loads(self.sidecar.read_text(encoding="utf-8"))
        self.assertEqual(set(data), {"version", "twitchVodId", "videoFile", "offsetSeconds", "messages"})
        self.assertEqual((data["version"], data["twitchVodId"], data["videoFile"], data["offsetSeconds"]),
                         (1, VOD, VIDEO, 0))
        # sorted; equal 5.25 keeps source order (c-b before c-a); 5.2499 stays before 5.25
        self.assertEqual([m["id"] for m in data["messages"]],
                         ["c-bad-emote", "c-sub", "c-b", "c-a", "c-late"])
        self.assertEqual([m["offsetSeconds"] for m in data["messages"]], [0, 5.2499, 5.25, 5.25, 20.5])
        self.assertEqual(result["duplicatesDropped"], 1)
        self.assertEqual(result["conflictingDuplicates"], 0)
        self.assertEqual(result["emotesDropped"], 2)   # bttv99 + unsafe id; the dropped duplicate isn't counted
        late = data["messages"][-1]
        self.assertEqual((late["user"], late["text"]), ("Zoë", "late 日本語 ✨"))
        self.assertIn("日本語", self.sidecar.read_text(encoding="utf-8"))   # stored as real UTF-8, not \u escapes
        self.assertEqual(result["status"], "ok")

    def test_emote_fragments_and_fallbacks(self):
        self.normalize(FIXTURE)
        by_id = {m["id"]: m for m in json.loads(self.sidecar.read_text(encoding="utf-8"))["messages"]}
        self.assertEqual(by_id["c-a"]["fragments"], [
            {"text": "Kappa", "emoteUrl": EMOTE_25}, {"text": " nice "}, {"text": "BTTVwow"}])  # 3rd party dropped
        self.assertEqual(by_id["c-bad-emote"]["fragments"], [{"text": "evil"}])             # unsafe id dropped
        self.assertEqual(by_id["c-sub"]["fragments"], [{"text": "sub-second earlier"}])      # missing fragments
        self.assertEqual(by_id["c-sub"]["user"], "subbot")                                   # name fallback

    def test_offset_seconds_goes_in_sidecar_not_messages(self):
        self.normalize(FIXTURE, offset_seconds="-2.5")
        data = json.loads(self.sidecar.read_text(encoding="utf-8"))
        self.assertEqual(data["offsetSeconds"], -2.5)
        self.assertEqual(data["messages"][-1]["offsetSeconds"], 20.5)

    def test_non_finite_offset_rejected(self):
        for bad in ("nan", "inf", "-inf", "abc"):
            with self.assertRaises(cs.ValidationError):
                self.normalize(FIXTURE, offset_seconds=bad)
        self.assertEqual(self.leftovers(), [])

    def test_valid_empty_chat_is_distinct_from_failure(self):
        result = self.normalize(EMPTY_FIXTURE)
        self.assertEqual(result["status"], "empty")
        self.assertEqual(json.loads(self.sidecar.read_text(encoding="utf-8"))["messages"], [])
        with self.assertRaises(cs.ValidationError):
            self.normalize(EMPTY_FIXTURE, require_messages=True)

    def test_empty_chat_does_not_replace_populated_sidecar(self):
        self.normalize(FIXTURE)
        before = self.sidecar.read_bytes()
        with self.assertRaises(cs.ValidationError):
            self.normalize(EMPTY_FIXTURE)
        self.assertEqual(self.sidecar.read_bytes(), before)
        self.assertEqual(self.normalize(EMPTY_FIXTURE, replace_with_empty=True)["status"], "empty")

    def test_conflicting_duplicate_id_keeps_first(self):
        raw = fixture()
        dup = copy.deepcopy(raw["comments"][0])
        dup["message"]["body"] = "changed"
        dup["message"]["fragments"] = [{"text": "changed"}]
        raw["comments"].append(dup)
        result = self.normalize(self.write_raw(raw))
        self.assertEqual(result["conflictingDuplicates"], 1)
        self.assertEqual(json.loads(self.sidecar.read_text(encoding="utf-8"))["messages"][-1]["text"],
                         "late 日本語 ✨")

    def test_gzip_input(self):
        gz = self.dir / "chat.json.gz"
        gz.write_bytes(gzip.compress(FIXTURE.read_bytes()))
        self.assertEqual(self.normalize(gz)["messages"], 5)

    def test_keep_raw(self):
        raw_dir = self.dir / "raw"
        result = self.normalize(FIXTURE, keep_raw_dir=raw_dir)
        kept = raw_dir / "[10-1-26] smizzles - Dots. in title.chat.raw.json"
        self.assertEqual(kept.read_bytes(), FIXTURE.read_bytes())
        self.assertEqual(result["raw"], str(kept))

    def test_video_file_must_be_explicit_video_name(self):
        for bad in ("", "..", "noext", "chat.txt", "dir/", "dir/a.mp4"):
            with self.assertRaises(cs.ValidationError, msg=bad):
                self.normalize(FIXTURE, video=bad)
        for path in ("some/dir/clip.mkv", "some\\dir\\clip.mkv"):    # a path is not an exact archived name
            with self.assertRaises(cs.ValidationError, msg=path):
                self.normalize(FIXTURE, video=path)
        self.assertEqual(self.leftovers(), [])
        self.normalize(FIXTURE, video="clip.mkv")
        self.assertTrue((self.out / "clip.chat.json").exists())
        self.assertEqual(json.loads((self.out / "clip.chat.json").read_text(encoding="utf-8"))["videoFile"],
                         "clip.mkv")

    def test_vod_id_forms(self):
        self.assertEqual(cs.normalize_vod_id("v2500000001"), VOD)
        for bad in ("", "abc", "12 3", "https://twitch.tv/videos/1", "-5"):
            with self.assertRaises(cs.ValidationError):
                cs.normalize_vod_id(bad)


class RejectionTests(TempDirCase):
    def assertRejected(self, raw_path, **kw):
        with self.assertRaises(cs.ValidationError):
            self.normalize(raw_path, **kw)
        self.assertEqual(self.leftovers(), [])

    def test_wrong_video_id(self):
        self.assertRejected(FIXTURE, vod="2500000002")

    def test_mixed_comment_video_id(self):
        raw = fixture()
        raw["comments"][1]["content_id"] = "999"
        self.assertRejected(self.write_raw(raw))

    def test_no_video_id_anywhere(self):
        raw = fixture()
        del raw["video"]["id"]
        for c in raw["comments"]:
            c.pop("content_id")
        self.assertRejected(self.write_raw(raw))
        empty = json.loads(EMPTY_FIXTURE.read_text(encoding="utf-8"))
        del empty["video"]["id"]
        self.assertRejected(self.write_raw(empty, "e.json"))

    def test_truncated_and_malformed_json(self):
        data = FIXTURE.read_bytes()
        for name, payload in (("trunc.json", data[:len(data) // 2]), ("empty.json", b""),
                              ("junk.json", b"not json"), ("nan.json", b'{"comments": [NaN]}'),
                              ("gz.json", gzip.compress(data)[:-20])):
            p = self.dir / name
            p.write_bytes(payload)
            self.assertRejected(p)

    def test_missing_structure(self):
        for obj in ([], {}, {"video": {"id": VOD}}, {"comments": []}, {"video": {"id": VOD}, "comments": {}}):
            self.assertRejected(self.write_raw(obj))

    def test_bad_messages(self):
        mutations = {
            "no id": lambda c: c.pop("_id"),
            "empty id": lambda c: c.update(_id=""),
            "no offset": lambda c: c.pop("content_offset_seconds"),
            "negative offset": lambda c: c.update(content_offset_seconds=-1),
            "string offset": lambda c: c.update(content_offset_seconds="5"),
            "bool offset": lambda c: c.update(content_offset_seconds=True),
            "no message": lambda c: c.pop("message"),
            "non-string body": lambda c: c["message"].update(body=5),
            "lone surrogate": lambda c: c["message"].update(body="bad \ud800"),
        }
        for label, mutate in mutations.items():
            raw = fixture()
            mutate(raw["comments"][0])
            with self.subTest(label):
                self.assertRejected(self.write_raw(raw))

    def test_sidecar_validator_catches_bad_output(self):
        good, _ = cs.normalize_chat(fixture(), VOD, VIDEO)
        cs.validate_sidecar(good, VOD, VIDEO)
        cases = {
            "unsorted": lambda d: d["messages"].reverse(),
            "dup id": lambda d: d["messages"][1].update(id=d["messages"][0]["id"]),
            "nan offset": lambda d: d["messages"][0].update(offsetSeconds=float("nan")),
            "inf top offset": lambda d: d.update(offsetSeconds=float("inf")),
            "foreign emote": lambda d: d["messages"][3]["fragments"][0].update(emoteUrl="https://evil.example/x.png"),
            "http emote": lambda d: d["messages"][3]["fragments"][0].update(emoteUrl=EMOTE_25.replace("https", "http")),
            "extra key": lambda d: d.update(extra=1),
            "frag/text mismatch": lambda d: d["messages"][0].update(text="other"),
            "wrong version": lambda d: d.update(version=2),
        }
        for label, mutate in cases.items():
            bad = copy.deepcopy(good)
            mutate(bad)
            with self.subTest(label), self.assertRaises(cs.ValidationError):
                cs.validate_sidecar(bad, VOD, VIDEO)


class PreserveOnFailureTests(TempDirCase):
    def good_sidecar(self):
        self.normalize(FIXTURE)
        return self.sidecar.read_bytes()

    def test_bad_input_keeps_prior_output_and_leaves_no_temp_files(self):
        before = self.good_sidecar()
        bad = self.write_raw({"video": {"id": "999"}, "comments": []})
        with self.assertRaises(cs.ValidationError):
            self.normalize(bad)
        self.assertEqual(self.sidecar.read_bytes(), before)
        self.assertEqual(self.leftovers(), [self.sidecar.name])

    def test_replace_failure_keeps_prior_output(self):
        before = self.good_sidecar()
        real = os.replace
        os.replace = lambda *a, **k: (_ for _ in ()).throw(OSError("disk full"))
        try:
            with self.assertRaises(cs.OutputError):
                self.normalize(FIXTURE, offset_seconds=3)
        finally:
            os.replace = real
        self.assertEqual(self.sidecar.read_bytes(), before)
        self.assertEqual(self.leftovers(), [self.sidecar.name])

    def test_changed_chat_replaces_atomically(self):
        self.good_sidecar()
        self.normalize(FIXTURE, offset_seconds=3)
        self.assertEqual(json.loads(self.sidecar.read_text(encoding="utf-8"))["offsetSeconds"], 3)
        self.assertEqual(self.leftovers(), [self.sidecar.name])


class DownloaderTests(TempDirCase):
    def run_sync(self, mode, source=FIXTURE, timeout=30, **kw):
        os.environ.update(FAKE_MODE=mode, FAKE_SOURCE=str(source))
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("FAKE_MODE", "FAKE_SOURCE", "FAKE_ARGV_OUT")])
        return cs.sync_chat(VOD, VIDEO, self.out, downloader=[sys.executable, str(FAKE)],
                            timeout=timeout, **kw)

    def test_success_via_downloader(self):
        result = self.run_sync("ok")
        self.assertEqual((result["source"], result["messages"]), ("downloader", 5))
        self.assertTrue(self.sidecar.exists())

    def test_command_line_shape(self):
        argv_out = self.dir / "argv.txt"
        os.environ["FAKE_ARGV_OUT"] = str(argv_out)
        self.run_sync("argv", extra_args=["-t", "2"])
        args = argv_out.read_text(encoding="utf-8").split("\n")
        self.assertEqual(args[:3], ["chatdownload", "--id", VOD])
        self.assertEqual(args[3], "--output")
        self.assertEqual(args[-2:], ["-t", "2"])

    def test_failures_keep_prior_output(self):
        self.run_sync("ok")
        before = self.sidecar.read_bytes()
        for mode in ("fail", "none", "truncate"):
            with self.subTest(mode), self.assertRaises(cs.ChatSyncError):
                self.run_sync(mode)
            self.assertEqual(self.sidecar.read_bytes(), before)
            self.assertEqual(self.leftovers(), [self.sidecar.name])

    def test_failure_kinds(self):
        with self.assertRaises(cs.DownloaderError) as ctx:
            self.run_sync("fail")
        self.assertIn("rate limited", str(ctx.exception))
        with self.assertRaises(cs.ValidationError):
            self.run_sync("truncate")
        with self.assertRaises(cs.DownloaderError):
            self.run_sync("none")

    def test_timeout(self):
        with self.assertRaises(cs.DownloaderError) as ctx:
            self.run_sync("hang", timeout=1)
        self.assertIn("timed out", str(ctx.exception))
        self.assertEqual(self.leftovers(), [])

    def test_missing_downloader(self):
        with self.assertRaises(cs.DownloaderError):
            cs.sync_chat(VOD, VIDEO, self.out, downloader=["definitely-not-installed-xyz"])

    def test_downloader_returns_wrong_vod(self):
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("FAKE_MODE", "FAKE_SOURCE")])
        os.environ.update(FAKE_MODE="ok", FAKE_SOURCE=str(FIXTURE))
        with self.assertRaises(cs.ValidationError):
            cs.sync_chat("2500000009", VIDEO, self.out, downloader=[sys.executable, str(FAKE)])
        self.assertEqual(self.leftovers(), [])


def make_png(width, height, declared=None):
    """A real PNG; `declared` overrides the IHDR size (a tiny payload that claims a huge image)."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    w, h = declared or (width, height)
    rows = b"".join(b"\x00" + b"\x7b\x66\xc2\xff" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def b64(data):
    return base64.b64encode(data).decode("ascii")


def badge_fixture():
    return json.loads(BADGE_FIXTURE.read_text(encoding="utf-8"))


def badge_embedded(raw, name, version, **info):
    for badge in raw["embeddedData"]["twitchBadges"]:
        if badge["name"] == name:
            badge["versions"][version].update(info)


class BadgeColorTests(TempDirCase):
    def normalize_badges(self, raw=None, **kw):
        raw = raw or badge_fixture()
        return self.normalize(self.write_raw(raw), vod=BADGE_VOD, **kw)

    def read(self):
        return json.loads(self.sidecar.read_text(encoding="utf-8"))

    def test_real_shape_colours_and_badges_with_catalog_stored_once(self):
        result = self.normalize_badges()
        data = self.read()
        by_id = {m["id"]: m for m in data["messages"]}
        self.assertEqual(by_id["b-1"]["color"], "#5B99FF")
        self.assertEqual(by_id["b-1"]["badges"], [{"id": "moderator", "version": "1"},
                                                    {"id": "bot-badge", "version": "1"}])
        self.assertNotIn("color", by_id["b-2"])      # empty user_color
        self.assertNotIn("badges", by_id["b-2"])
        # the badge with no embedded image is dropped, the rest of b-3 survives
        self.assertEqual(by_id["b-3"]["badges"], [{"id": "subscriber", "version": "12"},
                                                    {"id": "moderator", "version": "1"}])
        self.assertEqual(by_id["b-3"]["fragments"][0], {"text": "Kappa", "emoteUrl": EMOTE_25})
        catalog = data["badgeCatalog"]
        self.assertEqual([(c["id"], c["version"]) for c in catalog],
                         [("moderator", "1"), ("bot-badge", "1"), ("subscriber", "12")])   # used only, once each
        self.assertEqual(catalog[1]["title"], "Chat Bot")
        self.assertTrue(all(c["imageUrl"].startswith("data:image/png;base64,") for c in catalog))
        self.assertEqual((result["badgesDropped"], result["badgeCatalog"]), (1, 3))
        cs.validate_sidecar(data, BADGE_VOD, VIDEO)

    def test_old_fixture_output_has_no_optional_keys(self):
        self.normalize(FIXTURE)
        data = self.read()
        self.assertNotIn("badgeCatalog", data)
        self.assertTrue(all(set(m) == cs.MESSAGE_KEYS for m in data["messages"]))

    def test_legacy_sidecar_still_validates(self):
        good, _ = cs.normalize_chat(fixture(), VOD, VIDEO)
        cs.validate_sidecar(good, VOD, VIDEO)
        self.assertEqual(set(good), cs.SIDECAR_KEYS)

    def test_bad_colours_are_dropped_not_fatal(self):
        for bad in ("red", "#fff", "#GGGGGG", "#5B99FF ", "#5B99FFAA", 5, ["#5B99FF"], "rgb(1,2,3)"):
            raw = badge_fixture()
            raw["comments"][0]["message"]["user_color"] = bad
            with self.subTest(bad=bad):
                result = self.normalize_badges(raw)
                self.assertNotIn("color", {m["id"]: m for m in self.read()["messages"]}["b-1"])
                self.assertEqual(result["colorsDropped"], 1)
        raw = badge_fixture()
        raw["comments"][0]["message"]["user_color"] = "#5b99ff"
        self.normalize_badges(raw)
        self.assertEqual(self.read()["messages"][0]["color"], "#5b99ff")

    def test_unusable_embedded_images_drop_the_reference_only(self):
        good = b64(make_png(1, 1))
        cases = {
            "not base64": "!!!notbase64!!!",
            "non canonical": good + "\n",
            "not a png": b64(b"GIF89a" + b"\0" * 40),
            "signature only": b64(b"\x89PNG\r\n\x1a\n"),
            "truncated header": b64(make_png(1, 1)[:20]),
            "empty": "",
            "non string": 5,
            "too many bytes": b64(make_png(1, 1) + b"\0" * (cs.MAX_BADGE_BYTES + 1)),
            "declared too wide": b64(make_png(1, 1, declared=(257, 1))),
            "declared too tall": b64(make_png(1, 1, declared=(1, 4000000000))),
            "declared zero": b64(make_png(1, 1, declared=(0, 1))),
            "real 257px": b64(make_png(257, 2)),
        }
        for label, payload in cases.items():
            raw = badge_fixture()
            badge_embedded(raw, "moderator", "1", bytes=payload)
            with self.subTest(label):
                result = self.normalize_badges(raw)
                data = self.read()
                self.assertNotIn(("moderator", "1"), {(c["id"], c["version"]) for c in data.get("badgeCatalog", [])})
                self.assertEqual(len(data["messages"]), 3)              # chat is preserved
                self.assertGreaterEqual(result["badgesDropped"], 2)      # b-1 and b-3 lost the moderator badge
        self.assertEqual(cs.png_dimensions(make_png(256, 256)), (256, 256))
        raw = badge_fixture()
        badge_embedded(raw, "moderator", "1", bytes=b64(make_png(256, 256)))
        self.normalize_badges(raw)
        self.assertEqual(self.read()["badgeCatalog"][0]["id"], "moderator")

    def test_references_with_bad_ids_are_dropped_and_capped(self):
        raw = badge_fixture()
        refs = [{"_id": "moderator", "version": "1"}, {"_id": "moderator", "version": "1"}, "x", None,
                {"_id": "../evil", "version": "1"}, {"_id": "moderator", "version": 1},
                {"_id": "moderator"}, {"version": "1"}, {"_id": "a b", "version": "1"}]
        raw["comments"][0]["message"]["user_badges"] = refs
        self.normalize_badges(raw)
        self.assertEqual(self.read()["messages"][0]["badges"], [{"id": "moderator", "version": "1"}])
        raw = badge_fixture()
        names = [f"b{i}" for i in range(12)]
        raw["embeddedData"]["twitchBadges"] = [
            {"name": n, "versions": {"1": {"title": n, "bytes": b64(make_png(1, 1))}}} for n in names]
        raw["comments"][0]["message"]["user_badges"] = [{"_id": n, "version": "1"} for n in names]
        self.normalize_badges(raw)
        self.assertEqual(len(self.read()["messages"][0]["badges"]), cs.MAX_MESSAGE_BADGES)

    def test_titles_are_sanitised_with_fallbacks(self):
        raw = badge_fixture()
        rtl = chr(0x202E)
        badge_embedded(raw, "moderator", "1", title=rtl + "Mod\x00 <b>erator</b>\n" + "x" * 200)
        badge_embedded(raw, "bot-badge", "1", title=5, description="  ")
        self.normalize_badges(raw)
        catalog = {c["id"]: c for c in self.read()["badgeCatalog"]}
        self.assertTrue(catalog["moderator"]["title"].startswith("Mod <b>erator</b>x"))
        self.assertNotIn(rtl, catalog["moderator"]["title"])
        self.assertLessEqual(len(catalog["moderator"]["title"]), cs.MAX_BADGE_TITLE)
        self.assertEqual(catalog["bot-badge"]["title"], "bot-badge")

    def test_catalog_size_limits(self):
        count = cs.MAX_BADGE_CATALOG + 10
        raw = badge_fixture()
        raw["embeddedData"]["twitchBadges"] = [
            {"name": f"b{i}", "versions": {"1": {"title": "t", "bytes": b64(make_png(1, 1))}}} for i in range(count)]
        template = raw["comments"][0]
        raw["comments"] = [dict(template, _id=f"x{i}", content_offset_seconds=i,
                                message=dict(template["message"], user_badges=[{"_id": f"b{i}", "version": "1"}]))
                           for i in range(count)]
        self.normalize_badges(raw)
        data = self.read()
        self.assertEqual(len(data["badgeCatalog"]), cs.MAX_BADGE_CATALOG)
        self.assertEqual(len(data["messages"]), count)
        self.assertEqual(sum("badges" in m for m in data["messages"]), cs.MAX_BADGE_CATALOG)

    def test_total_image_budget(self):
        old = cs.MAX_BADGE_TOTAL_BYTES
        cs.MAX_BADGE_TOTAL_BYTES = len(make_png(1, 1)) * 2 + 1
        self.addCleanup(setattr, cs, "MAX_BADGE_TOTAL_BYTES", old)
        raw = badge_fixture()
        for badge in raw["embeddedData"]["twitchBadges"]:
            for info in badge["versions"].values():
                info["bytes"] = b64(make_png(1, 1))
        self.normalize_badges(raw)
        self.assertEqual(len(self.read()["badgeCatalog"]), 2)

    def test_missing_or_malformed_embedded_data_is_not_fatal(self):
        malformed = [None, [], {}, {"twitchBadges": None},
                     {"twitchBadges": [None, 5, {"name": 3}, {"name": "moderator"},
                                       {"name": "moderator", "versions": []}]}]
        for embedded in malformed:
            raw = badge_fixture()
            if embedded is None:
                del raw["embeddedData"]
            else:
                raw["embeddedData"] = embedded
            with self.subTest(embedded=embedded):
                self.normalize_badges(raw)
                data = self.read()
                self.assertNotIn("badgeCatalog", data)
                self.assertEqual(len(data["messages"]), 3)
                self.assertEqual(data["messages"][0]["color"], "#5B99FF")

    def test_validator_rejects_bad_catalogs_and_references(self):
        self.normalize_badges()
        good = self.read()
        cs.validate_sidecar(good, BADGE_VOD, VIDEO)
        png = b64(make_png(1, 1))
        prefix = cs.BADGE_IMAGE_PREFIX

        def entry(**over):
            return {"id": "x", "version": "1", "title": "X", "imageUrl": prefix + png, **over}

        cases = {
            "catalog not list": lambda d: d.update(badgeCatalog={}),
            "entry extra key": lambda d: d["badgeCatalog"].append(entry(extra=1)),
            "entry missing key": lambda d: d["badgeCatalog"].append({"id": "x", "version": "1"}),
            "bad id": lambda d: d["badgeCatalog"].append(entry(id="a b")),
            "bad version": lambda d: d["badgeCatalog"].append(entry(version="")),
            "empty title": lambda d: d["badgeCatalog"].append(entry(title="")),
            "long title": lambda d: d["badgeCatalog"].append(entry(title="t" * 65)),
            "control title": lambda d: d["badgeCatalog"].append(entry(title="a\x07b")),
            "duplicate": lambda d: d["badgeCatalog"].append(dict(d["badgeCatalog"][0])),
            "svg": lambda d: d["badgeCatalog"].append(entry(imageUrl="data:image/svg+xml;base64," + png)),
            "https image": lambda d: d["badgeCatalog"].append(entry(imageUrl="https://evil.example/x.png")),
            "inline html": lambda d: d["badgeCatalog"].append(entry(imageUrl=prefix + b64(b"<svg onload=1>"))),
            "bad base64": lambda d: d["badgeCatalog"].append(entry(imageUrl=prefix + "###")),
            "huge declared": lambda d: d["badgeCatalog"].append(
                entry(imageUrl=prefix + b64(make_png(1, 1, declared=(60000, 60000))))),
            "oversized": lambda d: d["badgeCatalog"].append(
                entry(imageUrl=prefix + b64(make_png(1, 1) + b"\0" * cs.MAX_BADGE_BYTES))),
            "too many": lambda d: d.update(badgeCatalog=[entry(id=f"b{i}") for i in range(cs.MAX_BADGE_CATALOG + 1)]),
            "ref not in catalog": lambda d: d["messages"][0]["badges"].append({"id": "nope", "version": "1"}),
            "ref extra key": lambda d: d["messages"][0]["badges"][0].update(extra=1),
            "ref duplicate": lambda d: d["messages"][0]["badges"].append(dict(d["messages"][0]["badges"][0])),
            "ref non-string": lambda d: d["messages"][0]["badges"].append({"id": "moderator", "version": 1}),
            "empty refs": lambda d: d["messages"][0].update(badges=[]),
            "refs not list": lambda d: d["messages"][0].update(badges={}),
            "too many refs": lambda d: d["messages"][0].update(
                badges=[{"id": "moderator", "version": "1"}] * (cs.MAX_MESSAGE_BADGES + 1)),
            "bad colour": lambda d: d["messages"][0].update(color="blue"),
            "colour non-string": lambda d: d["messages"][0].update(color=0xFFFFFF),
            "unknown message key": lambda d: d["messages"][0].update(bonus=1),
            "refs without catalog": lambda d: d.pop("badgeCatalog"),
        }
        for label, mutate in cases.items():
            bad = copy.deepcopy(good)
            mutate(bad)
            with self.subTest(label), self.assertRaises(cs.ValidationError):
                cs.validate_sidecar(bad, BADGE_VOD, VIDEO)

    def test_validator_total_budget(self):
        png = make_png(1, 1)
        old = cs.MAX_BADGE_TOTAL_BYTES
        cs.MAX_BADGE_TOTAL_BYTES = len(png) * 2 - 1
        self.addCleanup(setattr, cs, "MAX_BADGE_TOTAL_BYTES", old)
        data = {"version": 1, "twitchVodId": VOD, "videoFile": VIDEO, "offsetSeconds": 0, "messages": [],
                "badgeCatalog": [{"id": f"b{i}", "version": "1", "title": "t",
                                  "imageUrl": cs.BADGE_IMAGE_PREFIX + b64(png)} for i in range(2)]}
        with self.assertRaises(cs.ValidationError):
            cs.validate_sidecar(data, VOD, VIDEO)

    def test_conflicting_duplicate_detection_includes_metadata(self):
        raw = badge_fixture()
        dup = copy.deepcopy(raw["comments"][0])
        dup["message"]["user_color"] = "#000000"
        raw["comments"].append(dup)
        result = self.normalize_badges(raw)
        self.assertEqual((result["duplicatesDropped"], result["conflictingDuplicates"]), (1, 1))
        self.assertEqual(self.read()["messages"][0]["color"], "#5B99FF")   # first copy wins


class DownloadCommandTests(unittest.TestCase):
    def build(self, extra=()):
        return cs.build_download_command(["dl"], VOD, "out.json", extra)

    def test_defaults_embed_images_without_third_party_sets(self):
        cmd = self.build()
        self.assertEqual(cmd[:6], ["dl", "chatdownload", "--id", VOD, "--output", "out.json"])
        self.assertEqual(cmd[6:], ["-E", "--bttv", "false", "--ffz", "false", "--stv", "false"])

    def test_defaults_come_before_extra_args_and_can_be_overridden(self):
        self.assertEqual(self.build(["-t", "2"])[-2:], ["-t", "2"])
        cmd = self.build(["--bttv=true", "--embed-images"])
        self.assertEqual(cmd[6:], ["--ffz", "false", "--stv", "false", "--bttv=true", "--embed-images"])

    def test_reserved_flags_stay_blocked_and_embed_flag_is_not_confused_with_end_time(self):
        for bad in ("-e", "--ending", "--END=5", "-b", "--beginning", "-o", "--output=x", "--id", "-u"):
            with self.subTest(bad=bad), self.assertRaises(cs.ValidationError):
                self.build([bad])
        self.assertEqual(self.build(["-E"])[6:], ["--bttv", "false", "--ffz", "false", "--stv", "false", "-E"])


class DownloaderBadgeFlowTests(TempDirCase):
    def test_downloader_receives_embed_flags_and_badges_survive(self):
        argv_out = self.dir / "argv.txt"
        os.environ.update(FAKE_MODE="argv", FAKE_SOURCE=str(BADGE_FIXTURE), FAKE_ARGV_OUT=str(argv_out))
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("FAKE_MODE", "FAKE_SOURCE", "FAKE_ARGV_OUT")])
        cs.sync_chat(BADGE_VOD, VIDEO, self.out, downloader=[sys.executable, str(FAKE)], timeout=30)
        args = argv_out.read_text(encoding="utf-8").split("\n")
        self.assertEqual(args[-7:], ["-E", "--bttv", "false", "--ffz", "false", "--stv", "false"])
        data = json.loads(self.sidecar.read_text(encoding="utf-8"))
        self.assertEqual(len(data["badgeCatalog"]), 3)


class BrowserLimitTests(TempDirCase):
    def patch_limit(self, name, value):
        self.addCleanup(setattr, cs, name, getattr(cs, name))
        setattr(cs, name, value)

    def test_message_count_boundary(self):
        self.normalize(FIXTURE)
        messages = len(json.loads(self.sidecar.read_text(encoding="utf-8"))["messages"])
        self.patch_limit("MAX_MESSAGES", messages)
        self.normalize(FIXTURE, offset_seconds=1)
        self.patch_limit("MAX_MESSAGES", messages - 1)
        with self.assertRaisesRegex(cs.ValidationError, "browser limit"):
            self.normalize(FIXTURE, offset_seconds=2)

    def test_message_count_failure_keeps_prior_output_and_writes_no_raw(self):
        self.normalize(FIXTURE)
        before = self.sidecar.read_bytes()
        raw_dir = self.dir / "raw"
        self.patch_limit("MAX_MESSAGES", 1)
        with self.assertRaises(cs.ValidationError):
            self.normalize(FIXTURE, offset_seconds=3, keep_raw_dir=raw_dir)
        self.assertEqual(self.sidecar.read_bytes(), before)
        self.assertEqual(self.leftovers(), [self.sidecar.name])
        self.assertFalse(raw_dir.exists())

    def test_validator_rejects_too_many_messages(self):
        self.normalize(FIXTURE)
        sidecar = json.loads(self.sidecar.read_text(encoding="utf-8"))
        cs.validate_sidecar(sidecar, VOD, VIDEO)
        self.patch_limit("MAX_MESSAGES", len(sidecar["messages"]) - 1)
        with self.assertRaisesRegex(cs.ValidationError, "browser limit"):
            cs.validate_sidecar(sidecar, VOD, VIDEO)

    def test_serialized_byte_boundary_counts_utf8_bytes(self):
        self.normalize(FIXTURE)
        size = len(self.sidecar.read_bytes())
        self.assertGreater(size, len(self.sidecar.read_text(encoding="utf-8")))
        self.patch_limit("MAX_SIDECAR_BYTES", size)
        self.normalize(FIXTURE)
        self.assertEqual(len(self.sidecar.read_bytes()), size)
        self.patch_limit("MAX_SIDECAR_BYTES", size - 1)
        with self.assertRaisesRegex(cs.ValidationError, "browser limit"):
            self.normalize(FIXTURE)

    def test_byte_limit_failure_keeps_prior_output_and_writes_no_raw(self):
        self.normalize(FIXTURE)
        before = self.sidecar.read_bytes()
        raw_dir = self.dir / "raw"
        self.patch_limit("MAX_SIDECAR_BYTES", 10)
        with self.assertRaises(cs.ValidationError):
            self.normalize(FIXTURE, offset_seconds=3, keep_raw_dir=raw_dir)
        self.assertEqual(self.sidecar.read_bytes(), before)
        self.assertEqual(self.leftovers(), [self.sidecar.name])
        self.assertFalse(raw_dir.exists())

    def test_limit_failure_creates_no_output_for_a_new_sidecar(self):
        self.patch_limit("MAX_SIDECAR_BYTES", 10)
        with self.assertRaises(cs.ValidationError):
            self.normalize(FIXTURE)
        self.assertEqual(self.leftovers(), [])

    def test_cli_reports_limit_as_validation_failure(self):
        self.patch_limit("MAX_SIDECAR_BYTES", 10)
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cs.main(["--vod-id", VOD, "--video-file", VIDEO, "--output-dir", str(self.out),
                            "--normalize-only", str(FIXTURE)])
        self.assertEqual(code, cs.EXIT_VALIDATION)
        self.assertEqual(json.loads(out.getvalue())["kind"], "validation")

    def test_constants_match_the_browser(self):
        source_root = HERE.parents[2] / "src" / "watch" / "chat"
        replay = source_root / "replay.js"
        hook = source_root / "useChatReplay.js"
        if not (replay.is_file() and hook.is_file()):
            self.skipTest("frontend sources are not part of this checkout")
        messages = re.search(r"export const MAX_MESSAGES = ([0-9_]+);", replay.read_text(encoding="utf-8"))
        size = re.search(r"export const MAX_BYTES = ([0-9_]+) \* ([0-9_]+) \* ([0-9_]+);",
                         hook.read_text(encoding="utf-8"))
        self.assertIsNotNone(messages)
        self.assertIsNotNone(size)
        self.assertEqual(cs.MAX_MESSAGES, int(messages.group(1).replace("_", "")))
        self.assertEqual(cs.MAX_SIDECAR_BYTES,
                         int(size.group(1)) * int(size.group(2)) * int(size.group(3)))


class CliTests(TempDirCase):
    def call(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cs.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_normalize_only_cli(self):
        code, out, _ = self.call("--vod-id", VOD, "--video-file", VIDEO, "--output-dir", str(self.out),
                                 "--normalize-only", str(FIXTURE), "--offset-seconds", "1.5")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["status"], "ok")
        self.assertEqual(json.loads(self.sidecar.read_text(encoding="utf-8"))["offsetSeconds"], 1.5)

    def test_cli_exit_codes(self):
        base = ["--video-file", VIDEO, "--output-dir", str(self.out)]
        code, out, err = self.call("--vod-id", "1", *base, "--normalize-only", str(FIXTURE))
        self.assertEqual(code, cs.EXIT_VALIDATION)
        self.assertEqual(json.loads(out)["kind"], "validation")
        self.assertIn("error (validation)", err)
        code, _, _ = self.call("--vod-id", VOD, *base, "--downloader", "definitely-not-installed-xyz")
        self.assertEqual(code, cs.EXIT_DOWNLOADER)
        self.assertEqual(self.leftovers(), [])


if __name__ == "__main__":
    unittest.main()
