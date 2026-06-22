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
    zip_path = folder.with_suffix(".zip")
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

    for folder in folders:
        key = folder.name
        folder_date = _parse_folder_date(key)

        if key not in state:
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
                zip_path.unlink()
                uploaded_count += 1
                _log(f"Uploaded {key} -> Drive file {uploaded['id']}")
            except Exception as exc:  # noqa: BLE001 — log and continue with other folders
                _log(f"FAILED to upload {key}: {exc}")
                continue

        is_old = folder_date is not None and (now - folder_date) > timedelta(days=_RETENTION_DAYS)
        if is_old and key in state:
            shutil.rmtree(folder, ignore_errors=True)
            deleted_count += 1
            _log(f"Deleted local {key} (older than {_RETENTION_DAYS}d, already synced)")

    _log(f"Done. Uploaded {uploaded_count}, deleted {deleted_count} of {len(folders)} backup folders.")


if __name__ == "__main__":
    main()
