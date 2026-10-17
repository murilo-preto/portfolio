"""
Place coordinates encrypted at rest (location_crypto.py, migration 013)
=======================================================================

A place's latitude and longitude locate someone's home or work, so they are
stored as an AES-256-GCM blob bound to the owner. The first group needs no
database: the blob's round trip, and every way a blob or key can be wrong. The
second runs against the real database: no plain coordinate is ever left in a
row, a one-coordinate update keeps the other, legacy plain rows are encrypted
at boot, and boot refuses a key that does not open the stored places.

Run with:
  RUN_INTEGRATION_TESTS=true pytest test/test_location_crypto.py -v
"""
import base64
import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "flask-server"))

import location_crypto  # noqa: E402
from location_crypto import (  # noqa: E402
    LocationDecryptError,
    LocationKeyError,
    decrypt,
    encrypt,
    parse_key,
)

PASSWORD = "S3cur3P@ssw0rd!"
OFFICE = (-23.561414, -46.655881)


@pytest.fixture
def other_key():
    """Run a test under a different LOCATION_KEY, then put the real one back."""
    real = location_crypto.key()
    location_crypto._key = os.urandom(32)
    yield
    location_crypto._key = real


# ─── The blob (no database) ───────────────────────────────────────────────────


class TestBlob:
    def test_round_trip_keeps_six_decimals(self):
        assert decrypt(7, encrypt(7, *OFFICE)) == OFFICE

    def test_the_extremes_fit_the_column(self):
        blob = encrypt(7, -90.0, -180.0)
        assert len(blob) <= 64
        assert decrypt(7, blob) == (-90.0, -180.0)

    def test_the_same_place_encrypts_differently_each_time(self):
        assert encrypt(7, *OFFICE) != encrypt(7, *OFFICE)

    def test_the_coordinates_are_not_readable_in_the_blob(self):
        blob = encrypt(7, *OFFICE)
        assert b"23.561414" not in blob
        assert b"46.655881" not in blob

    def test_another_users_blob_does_not_decrypt(self):
        with pytest.raises(LocationDecryptError):
            decrypt(8, encrypt(7, *OFFICE))

    def test_an_altered_blob_does_not_decrypt(self):
        blob = bytearray(encrypt(7, *OFFICE))
        blob[-1] ^= 1
        with pytest.raises(LocationDecryptError):
            decrypt(7, bytes(blob))

    @pytest.mark.parametrize("blob", [None, b"", b"\x01short", b"\x02" + bytes(40)])
    def test_anything_but_a_blob_is_refused(self, blob):
        with pytest.raises(LocationDecryptError):
            decrypt(7, blob)

    def test_another_key_does_not_decrypt(self, other_key):
        blob = encrypt(7, *OFFICE)
        location_crypto._key = os.urandom(32)
        with pytest.raises(LocationDecryptError):
            decrypt(7, blob)


class TestKey:
    @pytest.mark.parametrize("value", [None, "", "   "])
    def test_a_missing_key_is_refused(self, value):
        with pytest.raises(LocationKeyError, match="not set"):
            parse_key(value)

    @pytest.mark.parametrize(
        "value",
        [
            "not base64 at all!",
            base64.urlsafe_b64encode(os.urandom(16)).decode(),
            base64.urlsafe_b64encode(os.urandom(64)).decode(),
        ],
    )
    def test_a_key_that_is_not_32_bytes_is_refused(self, value):
        with pytest.raises(LocationKeyError, match="32 bytes"):
            parse_key(value)

    def test_a_generated_key_is_valid(self):
        assert len(parse_key(location_crypto.generate_key())) == 32

    def test_surrounding_whitespace_is_ignored(self):
        value = location_crypto.generate_key()
        assert parse_key(f"  {value}\n") == parse_key(value)


# ─── Against the database ─────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def client():
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")
    from app import app

    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-location-crypto-64chars-long!!!!!!"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    with app.app_context(), app.test_client() as c:
        yield c


def _cursor():
    from app import get_cursor

    return get_cursor()


def _connect():
    from app import get_pool

    return get_pool().get_connection()


@pytest.fixture
def alice(client):
    """A user: (user id, web auth headers, a category id, username)."""
    username = f"crypto_{uuid.uuid4().hex[:12]}"
    assert client.post(
        "/register", json={"username": username, "password": PASSWORD}
    ).status_code == 201
    login = client.post("/login", json={"username": username, "password": PASSWORD})
    web = {"Authorization": f"Bearer {login.get_json()['access_token']}"}
    category_id = client.get("/get/categories", headers=web).get_json()["categories"][0]["id"]
    with _cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
        user_id = cursor.fetchone()["id"]
    return user_id, web, category_id, username


def _create(client, alice, name="Office", latitude=OFFICE[0], longitude=OFFICE[1]):
    response = client.post(
        "/places",
        headers=alice[1],
        json={
            "name": name,
            "category_id": alice[2],
            "latitude": latitude,
            "longitude": longitude,
        },
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()["place"]["id"]


def _row(place_id):
    with _cursor() as cursor:
        cursor.execute(
            "SELECT user_id, latitude, longitude, location_enc FROM places WHERE id = %s",
            (place_id,),
        )
        return cursor.fetchone()


def _listed(client, alice, place_id):
    places = client.get("/places", headers=alice[1]).get_json()["places"]
    [place] = [p for p in places if p["id"] == place_id]
    return place["latitude"], place["longitude"]


class TestStoredPlaces:
    def test_a_created_place_keeps_no_plain_coordinates(self, client, alice):
        row = _row(_create(client, alice))

        assert row["latitude"] is None
        assert row["longitude"] is None
        assert decrypt(row["user_id"], row["location_enc"]) == OFFICE

    def test_the_api_still_answers_in_plain_numbers(self, client, alice):
        place_id = _create(client, alice)
        assert _listed(client, alice, place_id) == OFFICE

    def test_updating_one_coordinate_keeps_the_other(self, client, alice):
        place_id = _create(client, alice)

        response = client.patch(
            f"/places/{place_id}", headers=alice[1], json={"latitude": 10.5}
        )

        assert response.status_code == 200
        assert response.get_json()["place"]["longitude"] == OFFICE[1]
        row = _row(place_id)
        assert (row["latitude"], row["longitude"]) == (None, None)
        assert decrypt(row["user_id"], row["location_enc"]) == (10.5, OFFICE[1])

    def test_other_updates_leave_the_blob_alone(self, client, alice):
        place_id = _create(client, alice)
        before = _row(place_id)["location_enc"]

        client.patch(f"/places/{place_id}", headers=alice[1], json={"name": "HQ"})

        assert _row(place_id)["location_enc"] == before

    def test_the_phone_gets_the_decrypted_places(self, client, alice):
        place_id = _create(client, alice)
        paired = client.post(
            "/devices/pair",
            json={"username": alice[3], "password": PASSWORD, "device_name": "Pixel"},
        )
        assert paired.status_code == 201
        device = {"Authorization": f"Device {paired.get_json()['token']}"}

        places = client.get("/devices/me/places", headers=device).get_json()["places"]

        assert [(p["id"], p["latitude"], p["longitude"]) for p in places] == [
            (place_id, *OFFICE)
        ]


class TestBoot:
    def test_legacy_plain_rows_are_encrypted_at_boot(self, client, alice):
        user_id, _, category_id, _ = alice
        with _cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO places (user_id, category_id, name, latitude, longitude)
                VALUES (%s, %s, 'Legacy', %s, %s)
                """,
                (user_id, category_id, *OFFICE),
            )
            place_id = cursor.lastrowid

        assert location_crypto.prepare(_connect) >= 1

        row = _row(place_id)
        assert (row["latitude"], row["longitude"]) == (None, None)
        assert decrypt(user_id, row["location_enc"]) == OFFICE
        assert _listed(client, alice, place_id) == OFFICE

    def test_boot_again_changes_nothing(self, client, alice):
        place_id = _create(client, alice)
        location_crypto.prepare(_connect)
        before = _row(place_id)["location_enc"]

        assert location_crypto.prepare(_connect) == 0
        assert _row(place_id)["location_enc"] == before

    def test_boot_refuses_a_key_that_does_not_open_the_places(self, client, alice, other_key):
        location_crypto._key = None
        _create(client, alice)  # under the real key, put back by the fixture...
        location_crypto._key = os.urandom(32)  # ...then booting with another

        with pytest.raises(LocationKeyError, match="does not decrypt"):
            location_crypto.prepare(_connect)

    def test_boot_refuses_a_missing_key(self, monkeypatch, other_key):
        location_crypto._key = None
        monkeypatch.delenv("LOCATION_KEY", raising=False)

        with pytest.raises(LocationKeyError, match="not set"):
            location_crypto.prepare(_connect)
