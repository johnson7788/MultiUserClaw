"""File storage helpers for the web API."""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from loguru import logger


def _is_safe_filename(filename: str) -> bool:
    """Check if filename is safe (no path separators or dot-prefixed)."""
    return bool(filename) and "/" not in filename and "\\" not in filename and not filename.startswith(".")


def _is_safe_file_id(file_id: str) -> bool:
    """Ensure file_id contains only hex characters."""
    return bool(file_id) and all(c in '0123456789abcdef' for c in file_id)


def _files_dir(workspace: Path) -> Path:
    """Return the files storage directory, creating it if needed."""
    d = workspace / "files"
    d.mkdir(parents=True, exist_ok=True)
    return d


def generate_file_id() -> str:
    """Generate a short unique file ID (12 hex chars)."""
    return uuid.uuid4().hex[:12]


def save_file(
    workspace: Path,
    file_id: str,
    filename: str,
    content: bytes,
    content_type: str,
    session_id: str = "web:default",
) -> dict[str, Any]:
    """Save a file to workspace/files/<file_id>/ and write metadata.json."""
    if not _is_safe_filename(filename):
        raise ValueError(f"Invalid filename: {filename}")
    file_dir = _files_dir(workspace) / file_id
    file_dir.mkdir(parents=True, exist_ok=True)

    file_path = file_dir / filename
    file_path.write_bytes(content)

    metadata = {
        "file_id": file_id,
        "name": filename,
        "content_type": content_type,
        "size": len(content),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "session_id": session_id,
    }
    (file_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")

    return metadata


def get_file_metadata(workspace: Path, file_id: str) -> dict[str, Any] | None:
    """Load metadata for a file. Returns None if not found or invalid."""
    if not _is_safe_file_id(file_id):
        return None
    meta_path = _files_dir(workspace) / file_id / "metadata.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError):
        logger.warning(f"Corrupted metadata file: {meta_path}")
        return None


def get_file_path(workspace: Path, file_id: str) -> Path | None:
    """Get the actual file path for a file_id. Returns None if not found."""
    meta = get_file_metadata(workspace, file_id)
    if meta is None:
        return None
    file_path = _files_dir(workspace) / file_id / meta["name"]
    # Ensure resolved path is within files directory
    try:
        file_path.resolve().relative_to(_files_dir(workspace).resolve())
    except ValueError:
        return None
    return file_path if file_path.exists() else None


def list_files(workspace: Path, session_id: str | None = None) -> list[dict[str, Any]]:
    """List all file metadata, optionally filtered by session_id."""
    files_dir = _files_dir(workspace)
    result = []
    for entry in sorted(files_dir.iterdir()):
        if not entry.is_dir():
            continue
        meta_path = entry / "metadata.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            continue
        if session_id and meta.get("session_id") != session_id:
            continue
        result.append(meta)
    return result


def delete_file(workspace: Path, file_id: str) -> bool:
    """Delete a file and its metadata. Returns True if deleted."""
    if not _is_safe_file_id(file_id):
        return False
    file_dir = _files_dir(workspace) / file_id
    if not file_dir.exists():
        return False
    shutil.rmtree(file_dir)
    return True


# ---------------------------------------------------------------------------
# Workspace browser helpers (browse the entire workspace directory)
# ---------------------------------------------------------------------------

import mimetypes


def _resolve_workspace_path(workspace: Path, rel_path: str) -> Path | None:
    """Resolve a relative path within workspace, rejecting traversal."""
    workspace = workspace.resolve()
    target = (workspace / rel_path).resolve()
    try:
        target.relative_to(workspace)
    except ValueError:
        return None
    return target


def browse_workspace(workspace: Path, rel_path: str = "") -> dict[str, Any]:
    """List contents of a directory within the workspace."""
    workspace = workspace.resolve()
    target = _resolve_workspace_path(workspace, rel_path)
    if target is None or not target.is_dir():
        raise ValueError("Invalid directory path")

    items: list[dict[str, Any]] = []
    try:
        entries = sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        raise ValueError("Permission denied")

    for entry in entries:
        # Skip hidden files/dirs
        if entry.name.startswith("."):
            continue
        rel = str(entry.relative_to(workspace))
        if entry.is_dir():
            items.append({
                "name": entry.name,
                "path": rel,
                "type": "directory",
                "size": None,
                "modified": datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
        elif entry.is_file():
            stat = entry.stat()
            ct, _ = mimetypes.guess_type(entry.name)
            items.append({
                "name": entry.name,
                "path": rel,
                "type": "file",
                "size": stat.st_size,
                "content_type": ct or "application/octet-stream",
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    return {
        "path": str(target.relative_to(workspace)) if target != workspace else "",
        "items": items,
    }


def workspace_file_path(workspace: Path, rel_path: str) -> Path | None:
    """Resolve a file path within workspace for download."""
    target = _resolve_workspace_path(workspace, rel_path)
    if target is None or not target.is_file():
        return None
    return target


def save_to_workspace(workspace: Path, rel_dir: str, filename: str, content: bytes) -> dict[str, Any]:
    """Save uploaded file to a specific directory in the workspace."""
    workspace = workspace.resolve()
    target_dir = _resolve_workspace_path(workspace, rel_dir)
    if target_dir is None:
        raise ValueError("Invalid directory path")
    target_dir.mkdir(parents=True, exist_ok=True)

    file_path = (target_dir / filename).resolve()
    try:
        file_path.relative_to(workspace)
    except ValueError:
        raise ValueError("Invalid filename")

    file_path.write_bytes(content)
    stat = file_path.stat()
    ct, _ = mimetypes.guess_type(filename)
    return {
        "name": filename,
        "path": str(file_path.relative_to(workspace)),
        "type": "file",
        "size": stat.st_size,
        "content_type": ct or "application/octet-stream",
        "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def delete_workspace_path(workspace: Path, rel_path: str) -> bool:
    """Delete a file or directory from the workspace."""
    target = _resolve_workspace_path(workspace, rel_path)
    if target is None or not target.exists():
        return False
    # Don't allow deleting the workspace root
    if target == workspace.resolve():
        return False
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return True


def create_workspace_dir(workspace: Path, rel_path: str) -> dict[str, Any]:
    """Create a directory in the workspace."""
    workspace = workspace.resolve()
    target = _resolve_workspace_path(workspace, rel_path)
    if target is None:
        raise ValueError("Invalid directory path")
    target.mkdir(parents=True, exist_ok=True)
    return {
        "name": target.name,
        "path": str(target.relative_to(workspace)),
        "type": "directory",
    }
