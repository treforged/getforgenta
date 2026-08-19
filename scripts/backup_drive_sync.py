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
_RETENTION_DAYS = 14
_DRIVE_FOLDER_NAME = "Forgenta Local Backups"

sys.path.insert(0, str(_ROOT / "tre-forged-marketing" / "src"))
from gdrive import _get_or_create_folder, _get_service  # noqa: E402


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
