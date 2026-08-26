from __future__ import annotations

import datetime as dt
import os
import secrets
import subprocess
import sys
from pathlib import Path


POC_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = POC_ROOT.parents[1]
COMPOSE_FILE = POC_ROOT / "compose.yaml"
RESULTS_DIR = POC_ROOT / "results"
EVIDENCE_FILE = RESULTS_DIR / "evidence.txt"
SUMMARY_FILE = RESULTS_DIR / "summary.md"


class Evidence:
    def __init__(self) -> None:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        self._handle = EVIDENCE_FILE.open("w", encoding="utf-8", newline="\n")

    def log(self, value: str) -> None:
        clean = value.rstrip()
        print(clean)
        self._handle.write(clean + "\n")
        self._handle.flush()

    def close(self) -> None:
        self._handle.close()


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run(evidence: Evidence, command: list[str], env: dict[str, str], *, stdin: Path | None = None) -> str:
    evidence.log("COMMAND=" + " ".join(command))
    input_bytes = stdin.read_bytes() if stdin else None
    completed = subprocess.run(command, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    output = completed.stdout.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n").rstrip()
    if output:
        evidence.log(output)
    if completed.returncode != 0:
        raise RuntimeError(f"command failed with exit code {completed.returncode}")
    return output


def compose(*args: str) -> list[str]:
    return ["docker", "compose", "-f", str(COMPOSE_FILE), *args]


def psql_args(database: str = "physical_model_poc", user: str = "postgres") -> list[str]:
    return compose("exec", "-T", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database)


def run_concurrency(evidence: Evidence, env: dict[str, str]) -> None:
    command = compose("exec", "-T", "postgres", "sh", "-s")
    evidence.log("COMMAND=postgres concurrency harness")
    script = (POC_ROOT / "postgres" / "03-concurrency.sh").read_bytes()
    completed = subprocess.run(command, input=script, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    output = completed.stdout.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n").rstrip()
    if output:
        evidence.log(output)
    if completed.returncode != 0:
        raise RuntimeError("PostgreSQL concurrency harness failed")


def write_summary(result: str, postgres_count: str, sqlite_count: str) -> None:
    SUMMARY_FILE.write_text(
        "\n".join(
            [
                "# TECH-002 R3 execution summary",
                "",
                f"- Result: `{result}`.",
                f"- PostgreSQL assertions: `{postgres_count}`.",
                f"- SQLite assertions: `{sqlite_count}`.",
                "- Scope: disposable physical-model subset; no product migration or application stack.",
                "- Security: partial evidence only; all `SEC-G01..SEC-G10` remain `PLANNED / NOT_EVALUATED`.",
                "- First migration: `NO-GO`.",
                "- TECH-002: `IN_PROGRESS`.",
                "",
            ]
        ),
        encoding="utf-8",
        newline="\n",
    )


def main() -> int:
    evidence = Evidence()
    env = os.environ.copy()
    env.setdefault("PHYSICAL_POC_POSTGRES_PASSWORD", secrets.token_hex(24))
    try:
        evidence.log(f"R3_RUN_STARTED_UTC={utc_now()}")
        evidence.log("GIT_HEAD=" + subprocess.check_output(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"], text=True).strip())
        run(evidence, compose("config", "--quiet"), env)
        run(evidence, compose("up", "-d", "--wait"), env)
        pg_version = run(evidence, psql_args(), env, stdin=POC_ROOT / "postgres" / "00-setup.sql")
        run(evidence, psql_args(), env, stdin=POC_ROOT / "postgres" / "01-seed.sql")
        test_output = run(evidence, psql_args(user="physical_poc_test_executor"), env, stdin=POC_ROOT / "postgres" / "02-tests.sql")
        run_concurrency(evidence, env)
        concurrency_output = run(evidence, psql_args(), env, stdin=POC_ROOT / "postgres" / "04-concurrency-checks.sql")

        evidence.log("=== PostgreSQL backup/restore ===")
        run(evidence, compose("exec", "-T", "postgres", "pg_dump", "-U", "postgres", "-d", "physical_model_poc", "-Fc", "-f", "/tmp/physical-model.dump"), env)
        run(evidence, compose("exec", "-T", "postgres", "pg_dumpall", "-U", "postgres", "--roles-only", "-f", "/tmp/physical-model-roles.sql"), env)
        run(evidence, psql_args(database="postgres"), env, stdin=POC_ROOT / "postgres" / "05-create-restore.sql")
        run(evidence, compose("exec", "-T", "postgres", "pg_restore", "-U", "postgres", "-d", "physical_model_poc_restore", "/tmp/physical-model.dump"), env)
        restore_output = run(evidence, psql_args(database="physical_model_poc_restore"), env, stdin=POC_ROOT / "postgres" / "06-restore-checks.sql")

        evidence.log("=== SQLite/WAL ===")
        sqlite_output = run(evidence, [sys.executable, str(POC_ROOT / "sqlite" / "test_sqlite.py")], env)

        postgres_count = next(line.split("=", 1)[1] for line in test_output.splitlines() if line.startswith("POSTGRES_TEST_COUNT="))
        postgres_concurrency_count = next(line.split("=", 1)[1] for line in concurrency_output.splitlines() if line.startswith("POSTGRES_CONCURRENCY_TEST_COUNT="))
        sqlite_count = next(line.split("=", 1)[1] for line in sqlite_output.splitlines() if line.startswith("SQLITE_TEST_COUNT="))
        if "POSTGRES_TEST_FAILURES=0" not in test_output:
            raise RuntimeError("PostgreSQL assertions reported failures")
        if "POSTGRES_CONCURRENCY_FAILURES=0" not in concurrency_output:
            raise RuntimeError("PostgreSQL concurrency assertions reported failures")
        if "POSTGRES_RESTORE_RESULT=PASS" not in restore_output:
            raise RuntimeError("PostgreSQL restore checks failed")
        if "SQLITE_TEST_FAILURES=0" not in sqlite_output or "SQLITE_RESULT=PASS" not in sqlite_output:
            raise RuntimeError("SQLite assertions reported failures")
        if "PostgreSQL 16." not in pg_version:
            raise RuntimeError("PostgreSQL major version is not 16")

        total_postgres = str(int(postgres_count) + int(postgres_concurrency_count))
        evidence.log(f"POSTGRES_TEST_COUNT_TOTAL={total_postgres}")
        evidence.log(f"SQLITE_TEST_COUNT_TOTAL={sqlite_count}")
        evidence.log("SECURITY_EVIDENCE=PARTIAL SEC-G01,SEC-G05,SEC-G06,SEC-G08,SEC-G09")
        evidence.log("SECURITY_GATE_STATES_UNCHANGED=PLANNED/NOT_EVALUATED")
        evidence.log("TECH_002_STATUS=IN_PROGRESS")
        evidence.log("FIRST_MIGRATION=NO-GO")
        evidence.log("R3_RESULT=PASS")
        evidence.log(f"R3_RUN_FINISHED_UTC={utc_now()}")
        write_summary("PASS", total_postgres, sqlite_count)
        return 0
    except Exception as exc:
        evidence.log(f"R3_FAILURE={type(exc).__name__}:{exc}")
        evidence.log("TECH_002_STATUS=IN_PROGRESS")
        evidence.log("FIRST_MIGRATION=NO-GO")
        evidence.log("R3_RESULT=FAIL")
        write_summary("FAIL", "see evidence", "see evidence")
        return 1
    finally:
        evidence.close()


if __name__ == "__main__":
    raise SystemExit(main())
