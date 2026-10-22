#!/usr/bin/env python3
"""Download a Twitch VOD's chat and normalize it into a ``<video stem>.chat.json`` sidecar.

LOCAL tooling. It wraps a separately installed TwitchDownloaderCLI
(``chatdownload --id ID --output temp.json``) and turns TwitchDownloader's JSON
into the sidecar the Nymphelia site reads:

    {"version": 1, "twitchVodId": "123", "videoFile": "<name>.mp4", "offsetSeconds": 0,
     "messages": [{"id", "offsetSeconds", "user", "text",
                   "fragments": [{"text", "emoteUrl"?}],
                   "color"?: "#rrggbb", "badges"?: [{"id", "version"}]}],
     "badgeCatalog"?: [{"id", "version", "title", "imageUrl": "data:image/png;base64,..."}]}

``badgeCatalog``, ``color`` and ``badges`` are optional; sidecars without them stay valid.
Badge images come from the downloader's embedded data (``-E``), are stored once in the
catalog and referenced by id + version from each message.

Nothing is written unless the downloader succeeded AND the whole output passes
the schema check and the browser's size limits (MAX_MESSAGES, MAX_SIDECAR_BYTES); the
previous good sidecar is only ever replaced atomically.
Python standard library only.
"""

import argparse
import base64
import binascii
import gzip
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

SIDECAR_VERSION = 1
SIDECAR_SUFFIX = ".chat.json"
RAW_SUFFIX = ".chat.raw.json"
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm"}
DEFAULT_DOWNLOADER = "TwitchDownloaderCLI"
DEFAULT_TIMEOUT = 1800

# Twitch first-party emotes are served from this one CDN; nothing else is accepted.
EMOTE_CDN_PREFIX = "https://static-cdn.jtvnw.net/emoticons/v2/"
EMOTE_ID_RE = re.compile(r"[A-Za-z0-9_]{1,64}")
EMOTE_URL_RE = re.compile(
    r"https://static-cdn\.jtvnw\.net/emoticons/v2/[A-Za-z0-9_]{1,64}/default/(?:dark|light)/[123]\.0")
VOD_ID_RE = re.compile(r"[0-9]{1,20}")
INVALID_NAME_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")

SIDECAR_KEYS = {"version", "twitchVodId", "videoFile", "offsetSeconds", "messages"}
SIDECAR_OPTIONAL_KEYS = {"badgeCatalog"}
MESSAGE_KEYS = {"id", "offsetSeconds", "user", "text", "fragments"}
MESSAGE_OPTIONAL_KEYS = {"color", "badges"}

# Username colours and chat badges (first-party Twitch data only).
COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")
BADGE_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
BADGE_VERSION_RE = re.compile(r"[A-Za-z0-9_.-]{1,32}")
UNSAFE_TEXT_RE = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]")
BADGE_IMAGE_PREFIX = "data:image/png;base64,"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_BADGE_BYTES = 32 * 1024            # decoded PNG size, per image
MAX_BADGE_DIMENSION = 256              # IHDR width/height: a tiny payload must not decode huge
MAX_BADGE_TITLE = 64
MAX_BADGE_CATALOG = 128
MAX_BADGE_TOTAL_BYTES = 2 * 1024 * 1024
MAX_MESSAGE_BADGES = 8
MAX_BADGE_B64 = (MAX_BADGE_BYTES + 2) // 3 * 4

MAX_MESSAGES = 300_000
MAX_SIDECAR_BYTES = 60 * 1024 * 1024

EXIT_OK, EXIT_VALIDATION, EXIT_DOWNLOADER, EXIT_IO = 0, 3, 4, 5


class ChatSyncError(Exception):
    kind = "error"
    exit_code = 1


class ValidationError(ChatSyncError):
    kind = "validation"
    exit_code = EXIT_VALIDATION


class DownloaderError(ChatSyncError):
    kind = "downloader"
    exit_code = EXIT_DOWNLOADER


class OutputError(ChatSyncError):
    kind = "io"
    exit_code = EXIT_IO


# --------------------------------------------------------------------------
# small validators
# --------------------------------------------------------------------------
def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_finite(value):
    try:
        return _is_number(value) and math.isfinite(value)
    except OverflowError:
        return False


def _check_text(value, where):
    if not isinstance(value, str):
        raise ValidationError(f"{where}: expected a string")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValidationError(f"{where}: text is not valid Unicode (lone surrogate)") from None


def parse_offset_seconds(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValidationError(f"offset-seconds {value!r} is not a number") from None
    if not math.isfinite(number):
        raise ValidationError("offset-seconds must be finite")
    return int(number) if number == int(number) else number


def normalize_vod_id(value):
    text = str(value).strip()
    if text[:1] in ("v", "V"):
        text = text[1:]
    if not VOD_ID_RE.fullmatch(text):
        raise ValidationError(f"vod-id {value!r} must be a numeric Twitch VOD id")
    return text


def sidecar_paths(video_file, output_dir):
    """-> (videoFile basename, sidecar Path). Name is the exact video stem + .chat.json."""
    name = str(video_file)
    if "/" in name or "\\" in name:
        raise ValidationError("video-file must be the exact archived basename, not a path")
    if name in ("", ".", "..") or INVALID_NAME_CHARS_RE.search(name):
        raise ValidationError(f"video-file {video_file!r} has no usable file name")
    stem, ext = os.path.splitext(name)
    if ext.lower() not in VIDEO_EXTENSIONS:
        raise ValidationError(
            f"video-file {name!r} must end in one of {', '.join(sorted(VIDEO_EXTENSIONS))}")
    if not stem or stem.startswith("."):
        raise ValidationError(f"video-file {name!r} has no usable stem")
    return name, Path(output_dir) / (stem + SIDECAR_SUFFIX), stem


# --------------------------------------------------------------------------
# sidecar schema check (used on the built object AND on the re-read bytes)
# --------------------------------------------------------------------------
def png_dimensions(png):
    """(width, height) from the IHDR chunk of a PNG byte string, or None if it isn't one."""
    if len(png) < 24 or not png.startswith(PNG_SIGNATURE):
        return None
    length, kind = struct.unpack(">I4s", png[8:16])
    if length != 13 or kind != b"IHDR":
        return None
    return struct.unpack(">II", png[16:24])


def _png_from_base64(payload):
    """Decoded PNG bytes if `payload` is canonical base64 of a bounded PNG, else None."""
    if not isinstance(payload, str) or not payload or len(payload) > MAX_BADGE_B64:
        return None
    try:
        png = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(png) > MAX_BADGE_BYTES or base64.b64encode(png).decode("ascii") != payload:
        return None
    size = png_dimensions(png)
    if size is None or not all(0 < side <= MAX_BADGE_DIMENSION for side in size):
        return None
    return png


def _check_badge_catalog(catalog):
    """Validate sidecar['badgeCatalog'] -> the set of (id, version) it defines."""
    if not isinstance(catalog, list):
        raise ValidationError("sidecar.badgeCatalog: must be a list")
    if len(catalog) > MAX_BADGE_CATALOG:
        raise ValidationError(f"sidecar.badgeCatalog: more than {MAX_BADGE_CATALOG} entries")
    keys, total = set(), 0
    for i, entry in enumerate(catalog):
        where = f"badgeCatalog[{i}]"
        if not isinstance(entry, dict) or set(entry) != {"id", "version", "title", "imageUrl"}:
            raise ValidationError(f"{where}: must have exactly id, imageUrl, title, version")
        if not (isinstance(entry["id"], str) and BADGE_ID_RE.fullmatch(entry["id"])):
            raise ValidationError(f"{where}: bad badge id")
        if not (isinstance(entry["version"], str) and BADGE_VERSION_RE.fullmatch(entry["version"])):
            raise ValidationError(f"{where}: bad badge version")
        title = entry["title"]
        if not (isinstance(title, str) and 0 < len(title) <= MAX_BADGE_TITLE
                and not UNSAFE_TEXT_RE.search(title) and title == title.strip()):
            raise ValidationError(f"{where}: bad badge title")
        _check_text(title, where + ".title")
        image = entry["imageUrl"]
        png = (_png_from_base64(image[len(BADGE_IMAGE_PREFIX):])
               if isinstance(image, str) and image.startswith(BADGE_IMAGE_PREFIX) else None)
        if png is None:
            raise ValidationError(f"{where}: imageUrl must be a canonical PNG data URL "
                                  f"(<= {MAX_BADGE_BYTES} bytes, <= {MAX_BADGE_DIMENSION}x{MAX_BADGE_DIMENSION})")
        key = (entry["id"], entry["version"])
        if key in keys:
            raise ValidationError(f"{where}: duplicate badge {key[0]}/{key[1]}")
        keys.add(key)
        total += len(png)
        if total > MAX_BADGE_TOTAL_BYTES:
            raise ValidationError("sidecar.badgeCatalog: images exceed the total size limit")
    return keys


def _check_message_extras(msg, where, badge_keys):
    if "color" in msg and not (isinstance(msg["color"], str) and COLOR_RE.fullmatch(msg["color"])):
        raise ValidationError(f"{where}: color must be #rrggbb")
    if "badges" in msg:
        refs = msg["badges"]
        if not isinstance(refs, list) or not refs or len(refs) > MAX_MESSAGE_BADGES:
            raise ValidationError(f"{where}: badges must be a list of 1-{MAX_MESSAGE_BADGES} references")
        seen = set()
        for ref in refs:
            if not isinstance(ref, dict) or set(ref) != {"id", "version"}:
                raise ValidationError(f"{where}: a badge reference must have exactly id, version")
            key = (ref["id"], ref["version"])
            if not all(isinstance(k, str) for k in key) or key not in badge_keys:
                raise ValidationError(f"{where}: badge reference is not in badgeCatalog")
            if key in seen:
                raise ValidationError(f"{where}: duplicate badge reference")
            seen.add(key)


def validate_sidecar(obj, vod_id=None, video_file=None):
    if (not isinstance(obj, dict) or not SIDECAR_KEYS <= set(obj)
            or not set(obj) <= SIDECAR_KEYS | SIDECAR_OPTIONAL_KEYS):
        raise ValidationError("sidecar: top level must have exactly " + ", ".join(sorted(SIDECAR_KEYS))
                              + " (+ optional " + ", ".join(sorted(SIDECAR_OPTIONAL_KEYS)) + ")")
    if obj["version"] != SIDECAR_VERSION or isinstance(obj["version"], bool):
        raise ValidationError(f"sidecar: version must be {SIDECAR_VERSION}")
    if not isinstance(obj["twitchVodId"], str) or not VOD_ID_RE.fullmatch(obj["twitchVodId"]):
        raise ValidationError("sidecar: twitchVodId must be a numeric string")
    if vod_id is not None and obj["twitchVodId"] != vod_id:
        raise ValidationError(f"sidecar: twitchVodId {obj['twitchVodId']!r} != expected {vod_id!r}")
    _check_text(obj["videoFile"], "sidecar.videoFile")
    if not obj["videoFile"] or (video_file is not None and obj["videoFile"] != video_file):
        raise ValidationError("sidecar: videoFile does not match the expected video")
    if not _is_finite(obj["offsetSeconds"]):
        raise ValidationError("sidecar: offsetSeconds must be a finite number")
    messages = obj["messages"]
    if not isinstance(messages, list):
        raise ValidationError("sidecar: messages must be a list")
    if len(messages) > MAX_MESSAGES:
        raise ValidationError(f"sidecar: {len(messages)} messages exceed the browser limit of {MAX_MESSAGES}")
    badge_keys = _check_badge_catalog(obj["badgeCatalog"]) if "badgeCatalog" in obj else set()

    seen, previous = set(), 0
    for i, msg in enumerate(messages):
        where = f"messages[{i}]"
        if (not isinstance(msg, dict) or not MESSAGE_KEYS <= set(msg)
                or not set(msg) <= MESSAGE_KEYS | MESSAGE_OPTIONAL_KEYS):
            raise ValidationError(f"{where}: must have exactly " + ", ".join(sorted(MESSAGE_KEYS))
                                  + " (+ optional " + ", ".join(sorted(MESSAGE_OPTIONAL_KEYS)) + ")")
        _check_text(msg["id"], where + ".id")
        if not msg["id"]:
            raise ValidationError(f"{where}: empty id")
        if msg["id"] in seen:
            raise ValidationError(f"{where}: duplicate id {msg['id']!r}")
        seen.add(msg["id"])
        offset = msg["offsetSeconds"]
        if not _is_finite(offset) or offset < 0:
            raise ValidationError(f"{where}: offsetSeconds must be finite and >= 0")
        if offset < previous:
            raise ValidationError(f"{where}: messages are not sorted by offsetSeconds")
        previous = offset
        _check_text(msg["user"], where + ".user")
        _check_text(msg["text"], where + ".text")
        fragments = msg["fragments"]
        if not isinstance(fragments, list):
            raise ValidationError(f"{where}: fragments must be a list")
        for j, frag in enumerate(fragments):
            fwhere = f"{where}.fragments[{j}]"
            if (not isinstance(frag, dict) or "text" not in frag
                    or not set(frag) <= {"text", "emoteUrl"}):
                raise ValidationError(f"{fwhere}: must be an object with text and optional emoteUrl")
            _check_text(frag["text"], fwhere + ".text")
            if "emoteUrl" in frag and not (
                    isinstance(frag["emoteUrl"], str) and EMOTE_URL_RE.fullmatch(frag["emoteUrl"])):
                raise ValidationError(f"{fwhere}: emoteUrl is not a Twitch emote CDN url")
        if "".join(f["text"] for f in fragments) != msg["text"]:
            raise ValidationError(f"{where}: fragments do not add up to text")
        _check_message_extras(msg, where, badge_keys)


# --------------------------------------------------------------------------
# TwitchDownloader JSON -> sidecar
# --------------------------------------------------------------------------
def _reject_constant(name):
    raise ValueError(f"non-finite number {name}")


def parse_json_bytes(data, what):
    if data[:2] == b"\x1f\x8b":
        try:
            data = gzip.decompress(data)
        except (OSError, EOFError) as exc:
            raise ValidationError(f"{what}: truncated or corrupt gzip ({exc})") from None
    try:
        text = data.decode("utf-8-sig")
        return json.loads(text, parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError) as exc:
        raise ValidationError(f"{what}: not valid complete JSON ({exc})") from None


def _emote_url(emote_id):
    return f"{EMOTE_CDN_PREFIX}{emote_id}/default/dark/2.0"


def _third_party_ids(raw):
    embedded = raw.get("embeddedData")
    if not isinstance(embedded, dict):
        return set()
    return {str(e.get("id")) for e in embedded.get("thirdParty") or [] if isinstance(e, dict)}


def _badge_sources(raw):
    """(name, version) -> embedded badge info, from embeddedData.twitchBadges (the only image source)."""
    embedded = raw.get("embeddedData")
    badges = embedded.get("twitchBadges") if isinstance(embedded, dict) else None
    sources = {}
    for badge in badges if isinstance(badges, list) else []:
        if not isinstance(badge, dict) or not isinstance(badge.get("name"), str):
            continue
        versions = badge.get("versions")
        for version, info in versions.items() if isinstance(versions, dict) else []:
            if isinstance(version, str) and isinstance(info, dict):
                sources.setdefault((badge["name"], version), info)
    return sources


def _catalog_entry(badge_id, version, info):
    """-> (catalog entry, decoded image size), or None when the embedded image is unusable."""
    png = _png_from_base64(info.get("bytes"))
    if png is None:
        return None
    title = badge_id
    for field in ("title", "description"):
        value = info.get(field)
        if isinstance(value, str):
            cleaned = UNSAFE_TEXT_RE.sub("", value).strip()[:MAX_BADGE_TITLE].strip()
            if cleaned:
                try:
                    cleaned.encode("utf-8")
                except UnicodeEncodeError:
                    continue
                title = cleaned
                break
    return ({"id": badge_id, "version": version, "title": title,
             "imageUrl": BADGE_IMAGE_PREFIX + info["bytes"]}, len(png))


def _message_color(message, local):
    color = message.get("user_color")
    if color in (None, ""):
        return None
    if isinstance(color, str) and COLOR_RE.fullmatch(color):
        return color
    local["colorsDropped"] += 1
    return None


def _badge_refs(message):
    """Well-formed, de-duplicated (id, version) references from message.user_badges (max 8)."""
    refs, seen = [], set()
    raw = message.get("user_badges")
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        key = (item.get("_id"), item.get("version"))
        if (isinstance(key[0], str) and BADGE_ID_RE.fullmatch(key[0]) and isinstance(key[1], str)
                and BADGE_VERSION_RE.fullmatch(key[1]) and key not in seen
                and len(refs) < MAX_MESSAGE_BADGES):
            seen.add(key)
            refs.append({"id": key[0], "version": key[1]})
    return refs


def _attach_badges(messages, sources, stats):
    """Resolve each message's badge references against the embedded images; return the catalog.

    Every distinct badge is stored once. References that can't be resolved (no embedded image,
    bad PNG, limits reached) are dropped; the message keeps its text and colour.
    """
    resolved, catalog, total = {}, [], 0
    for msg in messages:
        kept = []
        for ref in msg.pop("badges", []):
            key = (ref["id"], ref["version"])
            if key not in resolved:
                info = sources.get(key)
                built = _catalog_entry(key[0], key[1], info) if info is not None else None
                if built is not None and (len(catalog) >= MAX_BADGE_CATALOG
                                          or total + built[1] > MAX_BADGE_TOTAL_BYTES):
                    built = None
                if built is not None:
                    catalog.append(built[0])
                    total += built[1]
                resolved[key] = built is not None
            if resolved[key]:
                kept.append(ref)
            else:
                stats["badgesDropped"] += 1
        if kept:
            msg["badges"] = kept
    return catalog


def _fragments(message, third_party, stats):
    body = message.get("body")
    _check_text(body, "comment.message.body")
    out = []
    raw_fragments = message.get("fragments")
    if isinstance(raw_fragments, list) and raw_fragments:
        for frag in raw_fragments:
            if not isinstance(frag, dict) or not isinstance(frag.get("text"), str):
                out = None
                break
            item = {"text": frag["text"]}
            emoticon = frag.get("emoticon")
            if isinstance(emoticon, dict) and emoticon.get("emoticon_id") not in (None, ""):
                emote_id = str(emoticon["emoticon_id"])
                if EMOTE_ID_RE.fullmatch(emote_id) and emote_id not in third_party:
                    item["emoteUrl"] = _emote_url(emote_id)
                else:
                    stats["emotesDropped"] += 1
            out.append(item)
        if out is not None and "".join(f["text"] for f in out) == body:
            return body, out
        stats["fragmentMismatches"] += 1
    return body, ([{"text": body}] if body else [])


def normalize_chat(raw, vod_id, video_file, offset_seconds=0):
    """TwitchDownloader chat JSON (already parsed) -> (sidecar dict, stats). Raises ValidationError."""
    if not isinstance(raw, dict):
        raise ValidationError("chat json: top level is not an object")
    comments = raw.get("comments")
    video = raw.get("video")
    if not isinstance(comments, list):
        raise ValidationError("chat json: no 'comments' list - file is incomplete or not a chat download")
    if not isinstance(video, dict):
        raise ValidationError("chat json: no 'video' object - file is incomplete or not a chat download")

    # The id in the file must be the VOD we asked for; with no id anywhere we can't tell, so refuse.
    found_ids = set()
    if video.get("id") not in (None, ""):
        found_ids.add(str(video["id"]).lstrip("vV"))
    for c in comments:
        if isinstance(c, dict) and c.get("content_id") not in (None, ""):
            found_ids.add(str(c["content_id"]).lstrip("vV"))
    if not found_ids:
        raise ValidationError("chat json: contains no video id, cannot confirm it belongs to this VOD")
    if found_ids != {vod_id}:
        raise ValidationError(f"chat json: video id {sorted(found_ids)} does not match requested {vod_id}")

    third_party = _third_party_ids(raw)
    badge_sources = _badge_sources(raw)
    stats = {"emotesDropped": 0, "fragmentMismatches": 0, "duplicatesDropped": 0,
             "conflictingDuplicates": 0, "unknownUsers": 0, "badgesDropped": 0, "colorsDropped": 0}
    by_id, order = {}, []
    for i, c in enumerate(comments):
        where = f"comments[{i}]"
        if not isinstance(c, dict):
            raise ValidationError(f"{where}: not an object")
        cid = c.get("_id")
        if not isinstance(cid, str) or not cid:
            raise ValidationError(f"{where}: missing message _id")
        offset = c.get("content_offset_seconds")
        if not _is_finite(offset) or offset < 0:
            raise ValidationError(f"{where}: content_offset_seconds must be finite and >= 0")
        message = c.get("message")
        if not isinstance(message, dict):
            raise ValidationError(f"{where}: missing message object")
        commenter = c.get("commenter") if isinstance(c.get("commenter"), dict) else {}
        user = commenter.get("display_name") or commenter.get("name") or ""
        if not user:
            stats["unknownUsers"] += 1
            user = "(unknown)"
        _check_text(user, where + ".commenter")
        local = {"emotesDropped": 0, "fragmentMismatches": 0, "colorsDropped": 0}
        text, fragments = _fragments(message, third_party, local)
        entry = {"id": cid, "offsetSeconds": offset, "user": user, "text": text, "fragments": fragments}
        color = _message_color(message, local)
        if color:
            entry["color"] = color
        refs = _badge_refs(message)
        if refs:
            entry["badges"] = refs          # resolved against the embedded images below
        if cid in by_id:
            stats["duplicatesDropped"] += 1
            if by_id[cid] != entry:
                stats["conflictingDuplicates"] += 1   # first copy wins
            continue
        by_id[cid] = entry
        order.append(entry)
        for key, count in local.items():       # only count messages that are kept
            stats[key] += count

    # Python's sort is stable: equal timestamps keep the order they came in.
    order.sort(key=lambda m: m["offsetSeconds"])
    catalog = _attach_badges(order, badge_sources, stats)
    sidecar = {"version": SIDECAR_VERSION, "twitchVodId": vod_id, "videoFile": video_file,
               "offsetSeconds": offset_seconds, "messages": order}
    if catalog:
        sidecar["badgeCatalog"] = catalog
    validate_sidecar(sidecar, vod_id, video_file)
    stats["messages"] = len(order)
    stats["badgeCatalog"] = len(catalog)
    return sidecar, stats


# --------------------------------------------------------------------------
# downloader + atomic output
# --------------------------------------------------------------------------
# Embed Twitch's own images (badges, first-party emotes) but never third-party emote sets.
# A flag the caller passes explicitly replaces the default of the same name.
DEFAULT_DOWNLOAD_FLAGS = (
    (("-E", "--embed-images"), ["-E"]),
    (("--bttv",), ["--bttv", "false"]),
    (("--ffz",), ["--ffz", "false"]),
    (("--stv",), ["--stv", "false"]),
)


def build_download_command(prefix, vod_id, output_path, extra_args=()):
    # Extra flags must not redirect output or silently download only part of the VOD.
    # Short options are case-sensitive: -E embeds images, -e would be the end time.
    reserved_short = {"-u", "-o", "-b", "-e"}
    reserved_long = {"--id", "--output", "--beginning", "--begin", "--ending", "--end"}
    names = [arg.split("=", 1)[0] for arg in extra_args]
    if any(n in reserved_short or n.lower() in reserved_long for n in names):
        raise ValidationError("downloader arguments may not override VOD, output or time range")
    defaults = [arg for aliases, flags in DEFAULT_DOWNLOAD_FLAGS
                if not any(n in aliases for n in names) for arg in flags]
    return list(prefix) + ["chatdownload", "--id", vod_id, "--output", str(output_path),
                           *defaults, *extra_args]


def run_downloader(prefix, vod_id, output_path, timeout, extra_args=()):
    cmd = build_download_command(prefix, vod_id, output_path, extra_args)
    try:
        proc = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
    except FileNotFoundError:
        raise DownloaderError(f"downloader not found: {prefix[0]!r}") from None
    except subprocess.TimeoutExpired:
        raise DownloaderError(f"downloader timed out after {timeout}s") from None
    except OSError as exc:
        raise DownloaderError(f"could not run downloader: {exc}") from None
    if proc.returncode != 0:
        tail = ((proc.stderr or "") + (proc.stdout or "")).strip()[-1500:]
        raise DownloaderError(f"downloader exited {proc.returncode}: {tail}")
    if not Path(output_path).is_file() or Path(output_path).stat().st_size == 0:
        raise DownloaderError("downloader reported success but wrote no output file")


def _stage(directory, name, data):
    fd, tmp = tempfile.mkstemp(prefix=f".{name}.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return Path(tmp)


def commit_outputs(sidecar, vod_id, video_file, sidecar_path, raw_bytes=None, raw_path=None):
    """Serialize, re-read and re-validate the bytes, then atomically replace the target(s)."""
    try:
        data = (json.dumps(sidecar, ensure_ascii=False, separators=(",", ":"),
                           allow_nan=False) + "\n").encode("utf-8")
    except (UnicodeEncodeError, ValueError) as exc:
        raise ValidationError(f"sidecar cannot be serialized: {exc}") from None
    if len(data) > MAX_SIDECAR_BYTES:
        raise ValidationError(f"sidecar is {len(data)} bytes, over the browser limit of {MAX_SIDECAR_BYTES}")
    reread = json.loads(data.decode("utf-8"))
    validate_sidecar(reread, vod_id, video_file)
    if reread != sidecar:
        raise ValidationError("sidecar changed while serializing")

    staged = []
    try:
        directory = sidecar_path.parent
        directory.mkdir(parents=True, exist_ok=True)
        if raw_bytes is not None:
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            staged.append((_stage(raw_path.parent, raw_path.name, raw_bytes), raw_path))
        staged.append((_stage(directory, sidecar_path.name, data), sidecar_path))
        while staged:                     # raw first, sidecar last
            tmp, final = staged[0]
            os.replace(tmp, final)
            staged.pop(0)
    except OSError as exc:
        raise OutputError(f"could not write output: {exc}") from None
    finally:
        for tmp, _ in staged:
            tmp.unlink(missing_ok=True)


def _has_messages(sidecar_path):
    try:
        existing = json.loads(sidecar_path.read_text(encoding="utf-8"))
        return bool(existing["messages"])
    except (OSError, ValueError, KeyError, TypeError):
        return False


def sync_chat(vod_id, video_file, output_dir, downloader=None, offset_seconds=0,
              timeout=DEFAULT_TIMEOUT, normalize_only=None, keep_raw_dir=None,
              require_messages=False, replace_with_empty=False, extra_args=()):
    """Download (or read `normalize_only`) -> validate -> atomic sidecar. Returns a result dict.

    `downloader` is the argv prefix of the downloader (e.g. ["TwitchDownloaderCLI"]).
    """
    vod_id = normalize_vod_id(vod_id)
    if not _is_finite(timeout) or timeout <= 0:
        raise ValidationError("timeout must be finite and positive")
    offset_seconds = parse_offset_seconds(offset_seconds)
    name, sidecar_path, stem = sidecar_paths(video_file, output_dir)
    raw_path = Path(keep_raw_dir) / (stem + RAW_SUFFIX) if keep_raw_dir else None
    if sidecar_path.exists():
        try:
            existing = parse_json_bytes(sidecar_path.read_bytes(), "existing sidecar")
        except OSError as exc:
            raise OutputError(f"cannot read existing sidecar: {exc}") from None
        if not isinstance(existing, dict) or existing.get("videoFile") != name or existing.get("twitchVodId") != vod_id:
            raise ValidationError("existing sidecar belongs to a different video/VOD; refusing to replace it")

    if normalize_only is not None:
        try:
            raw_bytes = Path(normalize_only).read_bytes()
        except OSError as exc:
            raise ValidationError(f"cannot read {normalize_only}: {exc}") from None
        result_source = "file"
    else:
        prefix = downloader or [DEFAULT_DOWNLOADER]
        if len(prefix) == 1 and not Path(prefix[0]).is_file() and shutil.which(prefix[0]) is None:
            raise DownloaderError(f"downloader not found: {prefix[0]!r}")
        workdir = Path(tempfile.mkdtemp(prefix="chat-sync-"))
        try:
            tmp_json = workdir / "chat.json"
            run_downloader(prefix, vod_id, tmp_json, timeout, extra_args)
            try:
                raw_bytes = tmp_json.read_bytes()
            except OSError as exc:
                raise DownloaderError(f"cannot read downloader output: {exc}") from None
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
        result_source = "downloader"

    raw = parse_json_bytes(raw_bytes, "chat json")
    sidecar, stats = normalize_chat(raw, vod_id, name, offset_seconds)
    if require_messages and not sidecar["messages"]:
        raise ValidationError("chat is empty and --require-messages was given")
    if not sidecar["messages"] and not replace_with_empty and _has_messages(sidecar_path):
        raise ValidationError(f"new chat is empty but {sidecar_path.name} already has messages; "
                              "keeping it (use --replace-with-empty to override)")
    commit_outputs(sidecar, vod_id, name, sidecar_path,
                   raw_bytes if raw_path else None, raw_path)
    return {"status": "empty" if not sidecar["messages"] else "ok", "source": result_source,
            "output": str(sidecar_path), "raw": str(raw_path) if raw_path else None,
            "twitchVodId": vod_id, "videoFile": name, **stats}


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def build_parser():
    p = argparse.ArgumentParser(
        description="Download a Twitch VOD's chat with TwitchDownloaderCLI and write "
                    "<video stem>.chat.json. Exit codes: 0 ok, 3 invalid/unexpected data, "
                    "4 downloader failed/timed out, 5 could not write.")
    p.add_argument("--vod-id", required=True, help="numeric Twitch VOD id")
    p.add_argument("--video-file", required=True,
                   help="exact video file name this chat belongs to (explicit mapping, never guessed)")
    p.add_argument("--output-dir", required=True, help="directory for <stem>.chat.json")
    p.add_argument("--downloader", default=DEFAULT_DOWNLOADER,
                   help=f"TwitchDownloaderCLI executable (default: {DEFAULT_DOWNLOADER})")
    p.add_argument("--downloader-arg", action="append", default=[], metavar="ARG",
                   help="extra argument passed to chatdownload (repeatable, e.g. --downloader-arg=-t "
                        "--downloader-arg=2)")
    p.add_argument("--offset-seconds", default="0",
                   help="sidecar offsetSeconds: shift the site applies between chat time and video time")
    p.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT,
                   help=f"downloader timeout in seconds (default {DEFAULT_TIMEOUT})")
    p.add_argument("--normalize-only", metavar="CHAT_JSON",
                   help="skip the downloader; normalize this existing TwitchDownloader .json/.json.gz")
    p.add_argument("--keep-raw-dir", metavar="DIR",
                   help="also keep the validated raw download as <stem>.chat.raw.json here")
    p.add_argument("--replace-with-empty", action="store_true",
                   help="allow a valid empty chat to replace an existing sidecar that has messages")
    p.add_argument("--require-messages", action="store_true",
                   help="treat a valid but empty chat as an error")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        if args.timeout <= 0:
            raise ValidationError("timeout must be positive")
        result = sync_chat(args.vod_id, args.video_file, args.output_dir,
                           downloader=[args.downloader], offset_seconds=args.offset_seconds,
                           timeout=args.timeout, normalize_only=args.normalize_only,
                           keep_raw_dir=args.keep_raw_dir, require_messages=args.require_messages,
                           replace_with_empty=args.replace_with_empty,
                           extra_args=args.downloader_arg)
    except ChatSyncError as exc:
        print(f"error ({exc.kind}): {exc}", file=sys.stderr)
        print(json.dumps({"status": "error", "kind": exc.kind, "message": str(exc)}))
        return exc.exit_code
    print(json.dumps(result, ensure_ascii=False))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
