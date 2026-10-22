#!/usr/bin/env python3
"""Configure local SMTP delivery without exposing credentials in shell history."""

from __future__ import annotations

import getpass
import os
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / ".env.local"


def update_values(source: str, values: dict[str, str]) -> str:
    remaining = dict(values)
    output: list[str] = []
    for line in source.splitlines():
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
        if match and match.group(1) in remaining:
            key = match.group(1)
            output.append(f"{key}={remaining.pop(key)}")
        else:
            output.append(line)
    if remaining:
        if output and output[-1]:
            output.append("")
        output.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(output) + "\n"


def main() -> int:
    print("Configure Gmail SMTP for NestList invitations.")
    email = input("Gmail address: ").strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        print("Error: enter a complete email address.")
        return 1

    password = getpass.getpass("Google App Password (input is hidden): ").replace(
        " ", ""
    )
    if len(password) < 8:
        print("Error: enter a valid Google App Password.")
        return 1

    current = ENV_FILE.read_text() if ENV_FILE.exists() else ""
    ENV_FILE.write_text(
        update_values(
            current,
            {
                "SMTP_HOST": "smtp.gmail.com",
                "SMTP_PORT": "465",
                "SMTP_SECURE": "true",
                "SMTP_USER": email,
                "SMTP_PASSWORD": password,
                "EMAIL_FROM_ADDRESS": f"NestList <{email}>",
            },
        )
    )
    os.chmod(ENV_FILE, 0o600)
    print("Email delivery configured in .env.local. Restart NestList now.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
