from __future__ import annotations

import os
import secrets
import shutil
import subprocess
from pathlib import Path


POC_ROOT = Path(__file__).resolve().parents[1]
COMPOSE_FILE = POC_ROOT / "compose.yaml"


def main() -> int:
    env = os.environ.copy()
    env.setdefault("PHYSICAL_POC_POSTGRES_PASSWORD", secrets.token_hex(24))
    completed = subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "down", "--volumes", "--remove-orphans"],
        env=env,
        check=False,
    )
    work_dir = POC_ROOT / "work"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
