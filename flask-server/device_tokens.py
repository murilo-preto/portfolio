"""Device tokens for the Namu Android app.

A paired phone reports geofence events from a background task, with no browser
session to carry the JWT cookie. Each phone therefore gets its own credential at
pairing: a random token it keeps in the Android Keystore and presents as

    Authorization: Device <token>

The scheme is `Device` rather than `Bearer` on purpose. `limiter_key` asks
flask-jwt-extended for an identity on every request, and a Bearer header would
have it try to decode the device token as a JWT. A separate scheme keeps the two
credentials from ever being mistaken for each other.

Only the SHA-256 of a token is stored (migration 009 explains why not bcrypt).
Nothing here touches the database or imports app.py, so rate_limit.py can use
it to key requests before any view runs.
"""

import hashlib
import secrets

# Makes a leaked token recognisable in a log, a paste or a secret scanner.
TOKEN_PREFIX = "namu_dev_"
AUTH_SCHEME = "Device"

# 32 random bytes, the same entropy the hash is sized for.
_TOKEN_BYTES = 32


def generate_token():
    return TOKEN_PREFIX + secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token):
    """The 32-byte digest stored in devices.token_hash."""
    return hashlib.sha256(token.encode("utf-8")).digest()


def token_from_header(header_value):
    """The token in an `Authorization: Device <token>` header, or None.

    Anything else, including a JWT Bearer header, is None. The prefix is checked
    so an obviously wrong value is refused without a database lookup.
    """
    if not header_value:
        return None
    scheme, _, token = header_value.partition(" ")
    token = token.strip()
    if scheme != AUTH_SCHEME or not token.startswith(TOKEN_PREFIX):
        return None
    return token
