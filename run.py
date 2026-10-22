#!/usr/bin/env python3
"""Start the NestList development environment."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
ENV_TEMPLATE = PROJECT_ROOT / ".env.example"
ENV_FILE = PROJECT_ROOT / ".env.local"
NEXT_BINARY = PROJECT_ROOT / "node_modules" / ".bin" / "next"
MINIMUM_NODE_MAJOR = 22


class LauncherError(RuntimeError):
    """An actionable launcher error."""


def port_number(value: str) -> int:
    port = int(value)
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare and start the NestList Next.js development server."
    )
    parser.add_argument(
        "--with-supabase",
        action="store_true",
        help="start the local Supabase stack before the app (requires Docker)",
    )
    parser.add_argument(
        "--no-install",
        action="store_true",
        help="fail instead of installing missing npm dependencies",
    )
    parser.add_argument(
        "--host",
        default="localhost",
        help="hostname passed to Next.js (default: localhost)",
    )
    parser.add_argument(
        "--port",
        type=port_number,
        default=3000,
        help="port passed to Next.js (default: 3000)",
    )
    return parser.parse_args()


def executable(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise LauncherError(f"Required command '{name}' was not found in PATH.")
    return path


def check_node_version(node: str) -> None:
    result = subprocess.run(
        [node, "--version"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.fullmatch(r"v(\d+)(?:\.\d+){2}\s*", result.stdout)
    if match is None:
        raise LauncherError(f"Could not read the Node.js version: {result.stdout.strip()}")
    major = int(match.group(1))
    if major < MINIMUM_NODE_MAJOR:
        raise LauncherError(
            f"NestList requires Node.js {MINIMUM_NODE_MAJOR} or newer; found {result.stdout.strip()}."
        )


def ensure_env_file() -> None:
    if ENV_FILE.exists():
        return
    if not ENV_TEMPLATE.is_file():
        raise LauncherError(f"Missing environment template: {ENV_TEMPLATE}")

    shutil.copyfile(ENV_TEMPLATE, ENV_FILE)
    os.chmod(ENV_FILE, 0o600)
    print("Created .env.local from .env.example (permissions: 0600).")
    print("Add the required Supabase values before using authenticated features.")


def ensure_dependencies(npm: str, no_install: bool) -> None:
    if NEXT_BINARY.is_file():
        return
    if no_install:
        raise LauncherError(
            "npm dependencies are missing. Run 'npm install' or omit --no-install."
        )

    install_command = [npm, "ci"] if (PROJECT_ROOT / "package-lock.json").is_file() else [npm, "install"]
    print(f"Installing npm dependencies with '{' '.join(install_command[1:])}'...")
    subprocess.run(install_command, cwd=PROJECT_ROOT, check=True)


def start_supabase() -> None:
    docker = executable("docker")
    supabase = executable("supabase")

    docker_status = subprocess.run(
        [docker, "info"],
        cwd=PROJECT_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if docker_status.returncode != 0:
        raise LauncherError("Docker is not running. Start Docker Desktop and try again.")

    print("Starting the local Supabase stack...")
    subprocess.run([supabase, "start"], cwd=PROJECT_ROOT, check=True)


def run_app(npm: str, host: str, port: int) -> int:
    print(f"Starting NestList at http://{host}:{port}")
    command = [npm, "run", "dev", "--", "--hostname", host, "--port", str(port)]
    return subprocess.run(command, cwd=PROJECT_ROOT).returncode


def main() -> int:
    args = parse_args()
    try:
        node = executable("node")
        npm = executable("npm")
        check_node_version(node)
        ensure_env_file()
        ensure_dependencies(npm, args.no_install)
        if args.with_supabase:
            start_supabase()
        return run_app(npm, args.host, args.port)
    except subprocess.CalledProcessError as error:
        command = " ".join(str(part) for part in error.cmd)
        print(f"Command failed ({error.returncode}): {command}", file=sys.stderr)
        return error.returncode or 1
    except LauncherError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nStopped.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
