"""Place coordinates, encrypted at rest.

A place's latitude and longitude say where someone lives and works, to about
10 cm. They are stored as one AES-256-GCM blob in `places.location_enc`, never
as plain columns (the old `latitude`/`longitude` columns stay, NULL, for the
legacy rows `encrypt_plain_rows` converts at boot).

What this protects: a copy of the data that leaves the server without its
environment, such as a dump, a backup, a copied Docker volume or disk, or a
database-only read through SQL injection. What it does not: anyone who controls
the server can read LOCATION_KEY from the environment, and Flask must be able
to decrypt anyway, to send the places to the phone.

Blob layout: one version byte, a 12-byte random nonce, then the GCM ciphertext
and tag of "lat,lon" with six decimals. The owner's user id is bound as
associated data, so a blob copied onto another user's row fails to decrypt
rather than moving their place.

LOCATION_KEY is 32 random bytes, URL-safe base64 (`generate_key()`). Losing it
loses every place's coordinates; the places would have to be created again.
"""

import base64
import logging
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

KEY_ENV = "LOCATION_KEY"
VERSION = 1
NONCE_BYTES = 12

_key = None


class LocationKeyError(RuntimeError):
    """LOCATION_KEY is missing, malformed, or not the key the places use."""


class LocationDecryptError(ValueError):
    """A blob that is not ours, was altered, or belongs to another user."""


def generate_key():
    """A new LOCATION_KEY value."""
    return base64.urlsafe_b64encode(os.urandom(32)).decode()


def parse_key(value):
    """The 32 key bytes from a LOCATION_KEY value, or LocationKeyError."""
    if not value or not value.strip():
        raise LocationKeyError(
            f"{KEY_ENV} is not set. Generate one with: python -c \"import "
            f"location_crypto; print(location_crypto.generate_key())\""
        )
    try:
        key = base64.urlsafe_b64decode(value.strip().encode())
    except (ValueError, TypeError):
        key = b""
    if len(key) != 32:
        raise LocationKeyError(f"{KEY_ENV} must be 32 bytes, URL-safe base64")
    return key


def key():
    """The key from the environment, read once."""
    global _key
    if _key is None:
        _key = parse_key(os.getenv(KEY_ENV))
    return _key


def _aad(user_id):
    return f"namu-place:{int(user_id)}".encode()


def encrypt(user_id, latitude, longitude):
    nonce = os.urandom(NONCE_BYTES)
    plaintext = f"{latitude:.6f},{longitude:.6f}".encode()
    return bytes([VERSION]) + nonce + AESGCM(key()).encrypt(
        nonce, plaintext, _aad(user_id)
    )


def decrypt(user_id, blob):
    """(latitude, longitude) from a blob, or LocationDecryptError."""
    blob = bytes(blob) if blob is not None else b""
    if len(blob) < 1 + NONCE_BYTES + 16 or blob[0] != VERSION:
        raise LocationDecryptError("Not a location blob")
    nonce, ciphertext = blob[1 : 1 + NONCE_BYTES], blob[1 + NONCE_BYTES :]
    try:
        plaintext = AESGCM(key()).decrypt(nonce, ciphertext, _aad(user_id))
    except InvalidTag as e:
        raise LocationDecryptError("Location blob does not decrypt") from e
    latitude, longitude = plaintext.decode().split(",")
    return float(latitude), float(longitude)


def prepare(connect):
    """Run at boot, after the migrations: check the key, then encrypt legacy rows.

    Refuses to start (LocationKeyError) when the key is missing, or when it
    does not open the places already stored: running on with the wrong key
    would add places nobody could later read alongside ones nobody can now.
    Then any row still holding plain coordinates is encrypted and its plain
    columns cleared, in one transaction. Returns how many were converted.
    """
    key()
    connection = connect()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT user_id, location_enc FROM places "
            "WHERE location_enc IS NOT NULL LIMIT 1"
        )
        sample = cursor.fetchone()
        if sample:
            try:
                decrypt(sample["user_id"], sample["location_enc"])
            except LocationDecryptError as e:
                raise LocationKeyError(
                    f"{KEY_ENV} does not decrypt the stored places; is it the "
                    "key they were saved with?"
                ) from e

        cursor.execute(
            "SELECT id, user_id, latitude, longitude FROM places "
            "WHERE location_enc IS NULL AND latitude IS NOT NULL "
            "AND longitude IS NOT NULL FOR UPDATE"
        )
        rows = cursor.fetchall()
        for row in rows:
            cursor.execute(
                "UPDATE places SET location_enc = %s, latitude = NULL, "
                "longitude = NULL WHERE id = %s",
                (
                    encrypt(row["user_id"], float(row["latitude"]), float(row["longitude"])),
                    row["id"],
                ),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()

    if rows:
        logger.info(f"Encrypted the coordinates of {len(rows)} place(s)")
    return len(rows)
