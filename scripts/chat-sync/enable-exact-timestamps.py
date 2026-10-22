#!/usr/bin/env python3
"""Make vodsync.py log each VOD's exact start so chat_auto.py can qualify same-day streams.

vodsync prints `  VOD <id>  [MM-DD-YY] title`, a local DATE. A stream that begins after the chat cutoff on
the cutoff's own local day cannot be told from one before it by date alone. This helper inserts ONE line
right after that log call:

    log.info("    source published at %s", v["published"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

Nothing else changes: no downloader, capture, routing or state behaviour. It is standalone and stdlib only.

It never runs by itself and never touches a remote machine; run it on the VM, as the file's owner, after
review. The default is a dry run. With --apply it writes only if ALL hold, otherwise it refuses (exit 2)
and leaves the file and the directory untouched:

* the target is a regular file (not a symlink) that decodes as UTF-8 and compiles;
* the known anchor line occurs exactly once;
* the module already imports `timezone` from datetime (it is not added);
* the patched source compiles and differs from the original by exactly that one inserted line;
* (optional) --expect-sha256 matches the current file.

Writing: a timestamped backup next to the target (never overwritten), then a temp file in the same
directory with the original permissions, fsync, and an atomic os.replace. Already-patched files are left
alone (exit 0). To undo: copy the printed backup path back over the target. No service is restarted:
vodsync.service is a oneshot, so its next timer run reads the new file; a running vodrec.py never calls
sync_channel, so it is unaffected until its own restart and is unchanged either way.
"""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

DEFAULT_TARGET = "/opt/vodsync/vodsync.py"
ANCHOR_RE = re.compile(
    r'^(?P<indent>[ \t]*)log\.info\("  VOD %s  \[%s\] %s", v\["id"\], stamp, v\["title"\]\[:60\]\)[ \t]*(?=\r?$)', re.M)
INSERT = ('log.info("    source published at %s", '
          'v["published"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')


class Refusal(Exception):
    """The file is not in the known shape; nothing was written."""


def imports_timezone(tree):
    return any(isinstance(node, ast.ImportFrom) and node.module == "datetime" and node.level == 0
               and any(alias.name == "timezone" and alias.asname is None for alias in node.names)
               for node in tree.body)


def patch_source(text):
    """-> (patched text, 'patched' | 'already'). Raises Refusal unless the file is exactly as expected."""
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError) as exc:
        raise Refusal(f"target does not compile: {type(exc).__name__}") from None
    if not imports_timezone(tree):
        raise Refusal("target does not import timezone from datetime; refusing to add imports")
    matches = list(ANCHOR_RE.finditer(text))
    if len(matches) != 1:
        raise Refusal(f"expected the VOD log anchor exactly once, found {len(matches)}")
    match = matches[0]
    newline = "\r\n" if "\r\n" in text else "\n"
    line = match.group("indent") + INSERT
    after = text[match.end():]
    if after.startswith(newline + line) and text.count(INSERT) == 1:
        return text, "already"
    if INSERT in text:
        raise Refusal("the source-published line already exists somewhere other than right after the anchor")
    patched = text[:match.end()] + newline + line + text[match.end():]
    try:
        compile(patched, "vodsync.py", "exec")
    except (SyntaxError, ValueError) as exc:
        raise Refusal(f"patched source would not compile: {type(exc).__name__}") from None
    if patched.count(INSERT) != 1 or patched.count("\n") != text.count("\n") + 1 or \
            patched.replace(newline + line, "", 1) != text:
        raise Refusal("patched source differs from the original by more than the one inserted line")
    return patched, "patched"


def write_backup(target, backup):
    """Copy target to backup, created exclusively: an existing backup raises FileExistsError and is never touched."""
    with open(target, "rb") as source, open(backup, "xb") as handle:
        try:
            shutil.copyfileobj(source, handle)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            handle.close()
            backup.unlink(missing_ok=True)
            raise
    shutil.copystat(target, backup)


def atomic_write(target, data, backup_suffix):
    """Backup, then replace. Both live in the target's directory so os.replace is atomic."""
    directory = target.parent
    backup = directory / f"{target.name}.bak-exact-ts-{backup_suffix}"
    write_backup(target, backup)
    mode = stat.S_IMODE(target.stat().st_mode)
    fd, tmp = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return backup


def run(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", default=DEFAULT_TARGET, help="path of vodsync.py (default: %(default)s)")
    parser.add_argument("--apply", action="store_true", help="write the patch (default: dry run, nothing is written)")
    parser.add_argument("--expect-sha256", help="refuse unless the current file has exactly this SHA-256")
    args = parser.parse_args(argv)
    target = Path(args.target)
    try:
        if target.is_symlink() or not target.is_file():
            raise Refusal("target must be a regular file, not a symlink")
        raw = target.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if args.expect_sha256 and args.expect_sha256.lower() != digest:
            raise Refusal("target SHA-256 differs from --expect-sha256")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise Refusal("target is not UTF-8") from None
        patched, state = patch_source(text)
        result = {"target": str(target), "sha256Before": digest, "state": state, "applied": False}
        if state == "patched" and args.apply:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                raise Refusal("target changed while it was being checked")
            result["backup"] = str(atomic_write(target, patched.encode("utf-8"), stamp))
            result["applied"] = True
            result["sha256After"] = hashlib.sha256(patched.encode("utf-8")).hexdigest()
            result["note"] = "no service restarted; the next vodsync.service run uses the new file"
        elif state == "patched":
            result["note"] = "dry run: re-run with --apply to write"
        print(json.dumps(result))
        return 0
    except Refusal as exc:
        print(json.dumps({"target": str(target), "state": "refused", "reason": str(exc), "applied": False}))
        return 2
    except OSError as exc:
        print(json.dumps({"target": str(target), "state": "error", "reason": type(exc).__name__, "applied": False}))
        return 1


if __name__ == "__main__":
    sys.exit(run())
