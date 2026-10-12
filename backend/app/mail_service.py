"""Outgoing email for password resets.

If SMTP is configured (AEROHYDRO_SMTP_HOST, _PORT, _USER, _PASSWORD, _FROM) the
message is sent by email. Otherwise it is written to the development outbox
<storage>/outbox.log so a local user can open the link. The reset link is never
returned to the browser through the API.
"""

from __future__ import annotations

import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

from . import config


def smtp_configured() -> bool:
    return bool(os.getenv("AEROHYDRO_SMTP_HOST"))


def outbox_path():
    return config.STORAGE_DIR / "outbox.log"


def send(to: str, subject: str, body: str) -> str:
    if smtp_configured():
        msg = EmailMessage()
        msg["From"] = os.getenv("AEROHYDRO_SMTP_FROM", os.getenv("AEROHYDRO_SMTP_USER", "noreply@aerohydro.local"))
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(os.environ["AEROHYDRO_SMTP_HOST"], int(os.getenv("AEROHYDRO_SMTP_PORT", "587")), timeout=20) as s:
            s.starttls()
            if os.getenv("AEROHYDRO_SMTP_USER"):
                s.login(os.environ["AEROHYDRO_SMTP_USER"], os.getenv("AEROHYDRO_SMTP_PASSWORD", ""))
            s.send_message(msg)
        return "email"
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with outbox_path().open("a", encoding="utf-8") as f:
        f.write(f"--- {datetime.now(timezone.utc).isoformat(timespec='seconds')} | To: {to} | {subject}\n{body}\n\n")
    print(f"[outbox] {subject} for {to} written to {outbox_path()}")
    return "outbox"
