"""Runtime configuration, read once from the environment.

Nothing here has a secret default: credentials must be supplied by the environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    database_url: str
    # Role the worker switches to after connecting (SET ROLE). In production the worker's
    # login is a member of planb_worker only; locally we connect as the owner and drop privileges.
    db_role: str | None
    evidence_dir: Path
    migrations_dir: Path
    catalog_dir: Path
    finance_cli: Path
    user_agent: str
    anthropic_api_key: str | None
    extraction_model: str

    @staticmethod
    def load() -> Settings:
        return Settings(
            database_url=os.environ.get("DATABASE_URL", "postgresql://planb:planb@127.0.0.1:5432/planb_dev"),
            db_role=os.environ.get("PLANB_DB_ROLE") or None,
            evidence_dir=Path(os.environ.get("PLANB_EVIDENCE_DIR", REPO_ROOT / "var" / "evidence")),
            migrations_dir=REPO_ROOT / "supabase" / "migrations",
            catalog_dir=REPO_ROOT / "research" / "catalog",
            finance_cli=Path(os.environ.get("PLANB_FINANCE_CLI", REPO_ROOT / "packages" / "finance" / "dist" / "cli.mjs")),
            user_agent=os.environ.get(
                "PLANB_USER_AGENT", "PlanB-Research/0.1 (+research crawler; honours robots.txt)"
            ),
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
            extraction_model=os.environ.get("PLANB_EXTRACTION_MODEL", "claude-opus-5-5"),
        )
