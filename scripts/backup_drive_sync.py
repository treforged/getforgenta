"""
Daily backups/ -> Google Drive sync with a 14-day local retention window.

Run by a Windows Scheduled Task (see scripts/register-backup-sync-task.ps1).
Zips each backups/<timestamp>/ folder that hasn't been uploaded yet, uploads
it to the "Forgenta Local Backups" Drive folder, then deletes local backup
folders older than RETENTION_DAYS that are already confirmed uploaded.

Reuses the OAuth client already set up for tre-forged-marketing's Drive
uploads (credentials/token at tre-forged-marketing/memory/) — see
reference_compliance_docs_drive memory for the established pattern this
follows.
"""

import json
import os
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_BACKUPS_DIR = _ROOT / "backups"
_STATE_FILE = _BACKUPS_DIR / ".drive-sync-state.json"
_LOG_FILE = _ROOT / "scripts" / "backup-drive-sync.log"
# Env-overridable so a run can be made non-destructive: `FORGENTA_BACKUP_RETENTION_DAYS=100000`
# uploads without pruning anything. Added 2026-08-19 for the first run after the six-week outage --
# proving the upload path works again should not be the same action that deletes local copies.
_RETENTION_DAYS = int(os.environ.get("FORGENTA_BACKUP_RETENTION_DAYS", "14"))
# Set FORGENTA_BACKUP_DRY_RUN=1 to zip and report without uploading or deleting.
_DRY_RUN = os.environ.get("FORGENTA_BACKUP_DRY_RUN") == "1"
_DRIVE_FOLDER_NAME = "Forgenta Local Backups"

# Where the Drive helper lives, and why this is a search rather than one path.
#
# THIS IS THE SECOND HALF OF THE 2026-08-19 OUTAGE, and it is a different bug from the OneDrive
# lock. `tre-forged-marketing` used to sit inside this repo; it is now its own private repo, a
# SIBLING of it. The moment it moved, this import raised ModuleNotFoundError -- at module scope,
# before `main()` and before any logging could happen. Task Scheduler recorded the 2026-08-13 run
# as started and finished with result 0, and the log has nothing at all for that date. A job that
# dies at import is invisible to every safety measure inside the file.
#
# So: look in both places, allow an env override, and if it still cannot be found, say so in the
# LOG rather than only on a stderr nobody is reading.
_GDRIVE_CANDIDATES = [
    Path(p) for p in [os.environ.get("FORGENTA_MARKETING_SRC", "")] if p
] + [
    _ROOT / "tre-forged-marketing" / "src",       # historic: nested inside this repo
    _ROOT.parent / "tre-forged-marketing" / "src",  # current: sibling private repo
]

for _candidate in _GDRIVE_CANDIDATES:
    if (_candidate / "gdrive.py").exists():
        sys.path.insert(0, str(_candidate))
        break

try:
    from gdrive import _get_or_create_folder, _get_service  # noqa: E402
except ModuleNotFoundError as _exc:  # pragma: no cover - the failure this exists to make visible
    _searched = "; ".join(str(c) for c in _GDRIVE_CANDIDATES)
    _msg = (
        f"*** BACKUP SYNC CANNOT START: gdrive.py not found. Searched: {_searched}. "
        f"Set FORGENTA_MARKETING_SRC to its src/ directory. ({_exc}) ***"
    )
    try:
        with open(_ROOT / "scripts" / "backup-drive-sync.log", "a", encoding="utf-8") as _fh:
            _fh.write(f"{datetime.now().isoformat(timespec='seconds')}  {_msg}\n")
    except Exception:  # noqa: BLE001 - never let logging failure hide the real error
        pass
    raise SystemExit(_msg)


def _log(msg: str) -> None:
    line = f"{datetime.now().isoformat(timespec='seconds')}  {msg}"
    print(line)
    with open(_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _load_state() -> dict:
    if _STATE_FILE.exists():
        return json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    return {}


def _save_state(state: dict) -> None:
    _STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _parse_folder_date(name: str) -> datetime | None:
    try:
        return datetime.strptime(name, "%Y-%m-%d_%H%M%S")
    except ValueError:
        return None


def _zip_folder(folder: Path) -> Path:
    """Zip a backup folder to a TEMP path outside the repo.

    WHY NOT `folder.with_suffix(".zip")`, which is what this did until 2026-08-19: this repo lives
    under the user's Desktop, and that Desktop is redirected into OneDrive. Writing the zip beside
    the folder put a brand-new file inside a synced tree, OneDrive.Sync.Service opened it to upload
    it, and the very next line here could not read it:

        [WinError 32] The process cannot access the file because it is being used by another process

    That is why the failure was 100% consistent rather than intermittent -- it was not a race with
    a virus scanner, it was the sync client doing exactly its job, every time, on every file. 764
    consecutive failures from 2026-06-25 to 2026-08-06 with not one success in between.

    Zipping to the system temp directory takes the file out of the synced tree entirely, so nothing
    else has a reason to hold it. It also stops backups/ accumulating tens of MB of zips that
    OneDrive then syncs a second time, which was the same bug wasting bandwidth.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="forgenta-backup-"))
    zip_path = tmp_dir / f"{folder.name}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in folder.rglob("*"):
            if file.is_file():
                zf.write(file, file.relative_to(folder.parent))
    return zip_path


def main() -> None:
    if not _BACKUPS_DIR.exists():
        _log("No backups/ directory — nothing to do.")
        return

    state = _load_state()
    service = _get_service()
    folder_id = _get_or_create_folder(service, _DRIVE_FOLDER_NAME)

    from googleapiclient.http import MediaFileUpload

    folders = sorted(p for p in _BACKUPS_DIR.iterdir() if p.is_dir())
    now = datetime.now()
    uploaded_count = 0
    deleted_count = 0
    failed_count = 0

    for folder in folders:
        key = folder.name
        folder_date = _parse_folder_date(key)

        if key not in state:
            zip_path = None
            media = None
            try:
                zip_path = _zip_folder(folder)
                media = MediaFileUpload(str(zip_path), mimetype="application/zip", resumable=False)
                uploaded = service.files().create(
                    body={"name": zip_path.name, "parents": [folder_id]},
                    media_body=media,
                    fields="id",
                ).execute()
                state[key] = {"driveFileId": uploaded["id"], "uploadedAt": now.isoformat()}
                _save_state(state)
                uploaded_count += 1
                _log(f"Uploaded {key} -> Drive file {uploaded['id']}")
            except Exception as exc:  # noqa: BLE001 - log and continue with other folders
                failed_count += 1
                _log(f"FAILED to upload {key}: {exc}")
                continue
            finally:
                # MediaFileUpload keeps the handle open until it is collected, and on Windows an
                # open handle blocks the delete. Drop it before cleaning up, and clean up whether
                # the upload worked or not so a failed run cannot leave temp zips behind.
                media = None
                if zip_path is not None:
                    shutil.rmtree(zip_path.parent, ignore_errors=True)

        is_old = folder_date is not None and (now - folder_date) > timedelta(days=_RETENTION_DAYS)
        if is_old and key in state:
            shutil.rmtree(folder, ignore_errors=True)
            deleted_count += 1
            _log(f"Deleted local {key} (older than {_RETENTION_DAYS}d, already synced)")

    _log(
        f"Done. Uploaded {uploaded_count}, failed {failed_count}, "
        f"deleted {deleted_count} of {len(folders)} backup folders."
    )

    # A RUN THAT UPLOADS NOTHING AND FAILS SOMETHING IS A BROKEN SAFETY NET, and it has to say so
    # in words somebody scanning the log will catch. The old summary read "Uploaded 0, deleted 22"
    # every week for six weeks and nobody read it as an outage, because it looks identical to a run
    # with nothing to do. There was no difference in that wording between "all quiet" and "the
    # off-machine copy has stopped existing".
    if failed_count > 0 and uploaded_count == 0:
        _log(
            "*** BACKUP SYNC IS FAILING: nothing reached Drive this run. "
            "Local backups are the ONLY copy until this is fixed. ***"
        )


if __name__ == "__main__":
    # THE 2026-08-13 RUN LEFT NO TRACE AT ALL. Task Scheduler recorded it as started and finished,
    # and the log has nothing for that date -- so it died before reaching the first _log() call,
    # somewhere in _load_state() or _get_service() (expired credentials being the likeliest). A
    # backup job that fails BEFORE it can say anything is indistinguishable from one that never ran,
    # and that is precisely the failure a safety net must never have. So: say when a run starts, and
    # say why it stopped, whatever kills it.
    _log("Run started.")
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - the whole point is that nothing exits quietly
        _log(f"*** BACKUP SYNC CRASHED before completing: {type(exc).__name__}: {exc} ***")
        raise
