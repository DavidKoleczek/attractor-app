"""Download and cache the frontend build from GitHub Releases."""

import logging
import shutil
import tarfile
import tempfile
from pathlib import Path

import httpx

from .config import Settings

logger = logging.getLogger(__name__)


def fetch_frontend(settings: Settings, force: bool = False) -> Path:
    """Download the frontend tarball from GitHub Releases and cache it locally.

    Args:
        settings: Application settings (repo, tag, asset name, token, etc.).
        force: If ``True``, bypass the cache and re-download.

    Returns:
        Path to the directory containing the extracted frontend files.

    Raises:
        SystemExit: If the download fails and no cached build is available.
    """
    cache_dir = settings.data_dir / "frontend_cache"
    marker = cache_dir / ".version"
    index = cache_dir / "index.html"

    # ------------------------------------------------------------------
    # Cache hit – return immediately unless forced
    # ------------------------------------------------------------------
    if index.exists() and not force:
        logger.info("Using cached frontend build from %s", cache_dir)
        return cache_dir

    # ------------------------------------------------------------------
    # Build request headers
    # ------------------------------------------------------------------
    headers: dict[str, str] = {"Accept": "application/vnd.github+json"}
    if settings.github_token:
        headers["Authorization"] = f"token {settings.github_token}"

    try:
        # --------------------------------------------------------------
        # 1. Query the GitHub Releases API
        # --------------------------------------------------------------
        api_url = (
            f"https://api.github.com/repos/{settings.frontend_repo}"
            f"/releases/tags/{settings.frontend_release_tag}"
        )
        response = httpx.get(api_url, headers=headers, timeout=30)

        if response.status_code == 404:
            raise RuntimeError(
                "Release not found. Has the GitHub Action run at least once?"
            )
        if response.status_code in (401, 403):
            raise RuntimeError("Authentication required. Set ATTRACTOR_GITHUB_TOKEN.")
        if response.status_code != 200:
            raise RuntimeError(
                f"GitHub API error {response.status_code}: {response.text}"
            )

        release = response.json()

        # Find the matching asset
        asset = next(
            (
                a
                for a in release.get("assets", [])
                if a["name"] == settings.frontend_asset_name
            ),
            None,
        )
        if asset is None:
            raise RuntimeError(
                f"Asset '{settings.frontend_asset_name}' not found in release "
                f"'{settings.frontend_release_tag}'. "
                f"Available: {[a['name'] for a in release.get('assets', [])]}"
            )

        download_url: str = asset["browser_download_url"]
        commit_sha: str = release.get("body", "").strip() or "unknown"

        # --------------------------------------------------------------
        # 2. Download the tarball to a temporary file
        # --------------------------------------------------------------
        download_headers: dict[str, str] = {"Accept": "application/octet-stream"}
        if settings.github_token:
            download_headers["Authorization"] = f"token {settings.github_token}"

        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            tmp_path = Path(tmp.name)
            with httpx.stream(
                "GET",
                download_url,
                headers=download_headers,
                follow_redirects=True,
                timeout=120,
            ) as stream:
                for chunk in stream.iter_bytes():
                    tmp.write(chunk)

        # --------------------------------------------------------------
        # 3. Clear old cache and extract
        # --------------------------------------------------------------
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)

        with tarfile.open(tmp_path) as tar:
            tar.extractall(path=cache_dir)  # noqa: S202

        tmp_path.unlink(missing_ok=True)

        # --------------------------------------------------------------
        # 4. Write version marker
        # --------------------------------------------------------------
        marker.write_text(commit_sha)

        logger.info(
            "Frontend build downloaded and cached in %s (commit: %s)",
            cache_dir,
            commit_sha,
        )
        return cache_dir

    except (httpx.HTTPError, Exception) as exc:  # noqa: BLE001
        logger.warning("Failed to download frontend build: %s", exc)

        if index.exists():
            logger.warning("Falling back to stale cached frontend in %s", cache_dir)
            return cache_dir

        raise SystemExit(
            "No cached frontend available and download failed. "
            "Check your network connection or build the frontend manually.\n"
            f"  Error: {exc}"
        ) from exc
