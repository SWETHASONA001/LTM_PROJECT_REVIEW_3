"""Create or update a platform user.

    .venv/Scripts/python create_user.py you@company.com "Your Name" [--role engineer|operator|admin]

The password is prompted (not echoed) and stored only as a salted PBKDF2 hash
in backend/storage/users.json.
"""

import argparse
import getpass
import os

from app import auth_service

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("email")
parser.add_argument("name")
parser.add_argument("--role", default="engineer", choices=["engineer", "operator", "admin"])
args = parser.parse_args()

password = os.getenv("AEROHYDRO_NEW_PASSWORD") or getpass.getpass("Password (min 10 characters): ")
if not os.getenv("AEROHYDRO_NEW_PASSWORD") and getpass.getpass("Repeat password: ") != password:
    raise SystemExit("Passwords do not match.")
user = auth_service.create_user(args.email, args.name, password, args.role)
print(f"Saved user {user['email']} ({user['role']}).")
