"""Thin wrapper over GitHub REST API for attractor store operations."""

import httpx


class GitHubClient:
    """GitHub API client using a Personal Access Token."""

    BASE_URL = "https://api.github.com"

    def __init__(self, token: str) -> None:
        self.token = token
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def get_authenticated_user(self) -> dict:
        """GET /user -- validate token, return user info."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{self.BASE_URL}/user", headers=self._headers)
            resp.raise_for_status()
            return resp.json()

    async def repo_exists(self, owner: str, repo: str) -> bool:
        """Check if a repo exists (HEAD /repos/{owner}/{repo})."""
        async with httpx.AsyncClient() as client:
            resp = await client.head(
                f"{self.BASE_URL}/repos/{owner}/{repo}",
                headers=self._headers,
            )
            return resp.status_code == 200

    async def create_repo(
        self, name: str, private: bool = True, description: str = ""
    ) -> dict:
        """Create a new repo for the authenticated user (POST /user/repos)."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.BASE_URL}/user/repos",
                headers=self._headers,
                json={
                    "name": name,
                    "private": private,
                    "description": description,
                    "auto_init": False,
                },
            )
            if resp.status_code == 403:
                raise PermissionError("Token lacks permission to create repositories.")
            resp.raise_for_status()
            return resp.json()

    async def list_repos(self, prefix: str | None = None) -> list[dict]:
        """List repos for the authenticated user, optionally filtered by name prefix."""
        repos: list[dict] = []
        page = 1
        async with httpx.AsyncClient() as client:
            while True:
                resp = await client.get(
                    f"{self.BASE_URL}/user/repos",
                    headers=self._headers,
                    params={
                        "per_page": 100,
                        "page": page,
                        "sort": "updated",
                        "direction": "desc",
                    },
                )
                resp.raise_for_status()
                batch = resp.json()
                if not batch:
                    break
                for r in batch:
                    if prefix is None or r["name"].startswith(prefix):
                        repos.append(r)
                if len(batch) < 100:
                    break
                page += 1
        return repos
