"""
Place tests (routes/places.py)
==============================

Places are the pins the Namu Android app geofences. The web app creates and
edits them under the usual JWT; the phone reads the enabled ones with its device
token. These run against the real database and cover validation, the per-user
limits, and that one user can never see, change or delete another's places,
nor attach a place to someone else's category.

How a place affects deleting or merging its category is covered in
test_categories.py, alongside the rest of category administration.

Run with:
  RUN_INTEGRATION_TESTS=true pytest test/test_places.py -v
"""
import os
import sys
import uuid
from datetime import datetime

import pytest

pytestmark = pytest.mark.integration

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "flask-server"))

from app import app, get_cursor  # noqa: E402

PASSWORD = "S3cur3P@ssw0rd!"


@pytest.fixture(scope="module")
def client():
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")

    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-place-integration-64chars-long!!!!!!"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    with app.app_context(), app.test_client() as c:
        yield c


def _new_user(client):
    """Register a user; return (username, web auth headers, a category id)."""
    username = f"place_{uuid.uuid4().hex[:12]}"
    assert client.post(
        "/register", json={"username": username, "password": PASSWORD}
    ).status_code == 201
    login = client.post("/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200
    web = {"Authorization": f"Bearer {login.get_json()['access_token']}"}
    categories = client.get("/get/categories", headers=web).get_json()["categories"]
    return username, web, categories[0]["id"]


@pytest.fixture
def alice(client):
    return _new_user(client)


@pytest.fixture
def bob(client):
    return _new_user(client)


def _body(own_category_id, **overrides):
    body = {
        "name": "Office",
        "category_id": own_category_id,
        "latitude": -23.561414,
        "longitude": -46.655881,
    }
    body.update(overrides)
    return body


def _create(client, user, **overrides):
    _, web, category_id = user
    return client.post("/places", headers=web, json=_body(category_id, **overrides))


def _device_auth(client, user):
    paired = client.post(
        "/devices/pair",
        json={"username": user[0], "password": PASSWORD, "device_name": "Pixel 8"},
    )
    assert paired.status_code == 201
    return {"Authorization": f"Device {paired.get_json()['token']}"}


# ─── Create and list ──────────────────────────────────────────────────────────


class TestCreate:
    def test_a_place_is_created_with_defaults(self, client, alice):
        response = _create(client, alice)

        assert response.status_code == 201
        place = response.get_json()["place"]
        assert place["name"] == "Office"
        assert place["category_id"] == alice[2]
        assert place["latitude"] == -23.561414
        assert place["longitude"] == -46.655881
        assert place["radius_m"] == 150
        assert place["enabled"] is True
        assert isinstance(place["category"], str)

    def test_the_listing_returns_what_was_created(self, client, alice):
        created = _create(client, alice, name="Gym", radius_m=300).get_json()["place"]

        places = client.get("/places", headers=alice[1]).get_json()["places"]

        assert places == [created]

    def test_the_listing_is_sorted_by_name(self, client, alice):
        for name in ("Work", "Gym", "Library"):
            _create(client, alice, name=name)

        places = client.get("/places", headers=alice[1]).get_json()["places"]

        assert [p["name"] for p in places] == ["Gym", "Library", "Work"]

    def test_coordinates_are_kept_to_six_decimals(self, client, alice):
        place = _create(
            client, alice, latitude=12.3456789, longitude=-98.7654321
        ).get_json()["place"]
        assert (place["latitude"], place["longitude"]) == (12.345679, -98.765432)

    def test_the_name_is_trimmed(self, client, alice):
        assert _create(client, alice, name="  Office  ").get_json()["place"]["name"] == "Office"

    def test_a_name_can_only_be_used_once_per_user(self, client, alice, bob):
        assert _create(client, alice).status_code == 201

        response = _create(client, alice)
        assert response.status_code == 409
        assert "Office" in response.get_json()["error"]
        # Another user can still use it.
        assert _create(client, bob).status_code == 201

    @pytest.mark.parametrize("overrides", [
        {"name": ""},
        {"name": "   "},
        {"name": "a" * 101},
        {"name": 42},
        {"category_id": None},
        {"category_id": "1"},
        {"category_id": True},
        {"latitude": 90.5},
        {"latitude": -91},
        {"longitude": 180.1},
        {"latitude": "12.5"},
        {"latitude": True},
        {"latitude": None},
        {"radius_m": 99},
        {"radius_m": 2001},
        {"radius_m": 150.5},
        {"radius_m": "150"},
        {"enabled": "yes"},
    ], ids=lambda o: f"{next(iter(o))}={next(iter(o.values()))!r}"[:40])
    def test_invalid_fields_are_refused(self, client, alice, overrides):
        response = _create(client, alice, **overrides)
        assert response.status_code == 400
        assert client.get("/places", headers=alice[1]).get_json()["places"] == []

    @pytest.mark.parametrize("missing", ["name", "category_id", "latitude", "longitude"])
    def test_required_fields_must_be_present(self, client, alice, missing):
        body = _body(alice[2])
        del body[missing]
        assert client.post("/places", headers=alice[1], json=body).status_code == 400

    def test_a_body_that_is_not_json_is_refused(self, client, alice):
        response = client.post(
            "/places", headers=alice[1], data="nope", content_type="text/plain"
        )
        assert response.status_code == 400

    def test_the_radius_limits_are_inclusive(self, client, alice):
        assert _create(client, alice, name="Small", radius_m=100).status_code == 201
        assert _create(client, alice, name="Large", radius_m=2000).status_code == 201

    def test_a_user_can_have_at_most_100_places(self, client, alice):
        username, _, category_id = alice
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user_id = cursor.fetchone()["id"]
            cursor.executemany(
                """
                INSERT INTO places (user_id, category_id, name, latitude, longitude)
                VALUES (%s, %s, %s, 0, 0)
                """,
                [(user_id, category_id, f"Place {i}") for i in range(100)],
            )

        response = _create(client, alice, name="One too many")

        assert response.status_code == 409
        assert "100" in response.get_json()["error"]

    def test_listing_and_creating_need_a_web_login(self, client, alice):
        assert client.get("/places").status_code == 401
        assert client.post("/places", json=_body(alice[2])).status_code == 401
        device = _device_auth(client, alice)
        assert client.get("/places", headers=device).status_code == 401


# ─── Update and delete ────────────────────────────────────────────────────────


class TestUpdate:
    def test_only_the_fields_sent_change(self, client, alice):
        place = _create(client, alice).get_json()["place"]

        response = client.patch(
            f"/places/{place['id']}", headers=alice[1],
            json={"radius_m": 500, "enabled": False},
        )

        assert response.status_code == 200
        updated = response.get_json()["place"]
        assert updated == {**place, "radius_m": 500, "enabled": False}

    def test_every_field_can_be_changed(self, client, alice):
        place = _create(client, alice).get_json()["place"]
        other_category = client.post(
            "/category", headers=alice[1], json={"name": f"Errands {datetime.now().timestamp()}"}
        ).get_json()["category"]

        changes = {
            "name": "Studio",
            "category_id": other_category["id"],
            "latitude": 1.5,
            "longitude": 2.5,
            "radius_m": 1000,
            "enabled": False,
        }
        updated = client.patch(
            f"/places/{place['id']}", headers=alice[1], json=changes
        ).get_json()["place"]

        assert {k: updated[k] for k in changes} == changes
        assert updated["category"] == other_category["name"]

    def test_renaming_onto_another_place_is_refused(self, client, alice):
        _create(client, alice, name="Gym")
        office = _create(client, alice, name="Office").get_json()["place"]

        response = client.patch(
            f"/places/{office['id']}", headers=alice[1], json={"name": "Gym"}
        )
        assert response.status_code == 409

    def test_keeping_its_own_name_is_fine(self, client, alice):
        place = _create(client, alice).get_json()["place"]
        response = client.patch(
            f"/places/{place['id']}", headers=alice[1], json={"name": "Office"}
        )
        assert response.status_code == 200

    @pytest.mark.parametrize("body", [{}, {"colour": "red"}, {"radius_m": 50}],
                             ids=["empty", "unknown-key-only", "invalid-radius"])
    def test_an_update_with_nothing_valid_is_refused(self, client, alice, body):
        place = _create(client, alice).get_json()["place"]
        response = client.patch(f"/places/{place['id']}", headers=alice[1], json=body)
        assert response.status_code == 400

    def test_an_unknown_place_is_not_found(self, client, alice):
        response = client.patch("/places/99999999", headers=alice[1], json={"enabled": False})
        assert response.status_code == 404


class TestDelete:
    def test_deleting_removes_the_place(self, client, alice):
        place = _create(client, alice).get_json()["place"]

        assert client.delete(f"/places/{place['id']}", headers=alice[1]).status_code == 200
        assert client.get("/places", headers=alice[1]).get_json()["places"] == []

    def test_deleting_an_unknown_place_is_not_found(self, client, alice):
        assert client.delete("/places/99999999", headers=alice[1]).status_code == 404


# ─── One user cannot reach another's places ───────────────────────────────────


class TestOwnership:
    def test_the_listing_shows_only_the_callers_places(self, client, alice, bob):
        _create(client, alice, name="Alice's office")
        _create(client, bob, name="Bob's office")

        names = [p["name"] for p in client.get("/places", headers=alice[1]).get_json()["places"]]
        assert names == ["Alice's office"]

    def test_another_users_place_cannot_be_changed(self, client, alice, bob):
        place = _create(client, alice).get_json()["place"]

        response = client.patch(
            f"/places/{place['id']}", headers=bob[1], json={"enabled": False}
        )

        assert response.status_code == 404
        assert client.get("/places", headers=alice[1]).get_json()["places"] == [place]

    def test_another_users_place_cannot_be_deleted(self, client, alice, bob):
        place = _create(client, alice).get_json()["place"]

        assert client.delete(f"/places/{place['id']}", headers=bob[1]).status_code == 404
        assert client.get("/places", headers=alice[1]).get_json()["places"] == [place]

    def test_a_place_cannot_use_another_users_category(self, client, alice, bob):
        response = client.post("/places", headers=alice[1], json=_body(bob[2]))
        assert response.status_code == 404

    def test_a_place_cannot_be_moved_to_another_users_category(self, client, alice, bob):
        place = _create(client, alice).get_json()["place"]

        response = client.patch(
            f"/places/{place['id']}", headers=alice[1], json={"category_id": bob[2]}
        )

        assert response.status_code == 404
        assert client.get("/places", headers=alice[1]).get_json()["places"] == [place]


# ─── The phone's side ─────────────────────────────────────────────────────────


class TestDevicePlaces:
    def test_the_phone_gets_only_enabled_places(self, client, alice):
        watched = _create(client, alice, name="Office").get_json()["place"]
        _create(client, alice, name="Holiday home", enabled=False)

        response = client.get("/devices/me/places", headers=_device_auth(client, alice))

        assert response.status_code == 200
        assert response.get_json()["places"] == [watched]

    def test_the_phone_gets_only_its_owners_places(self, client, alice, bob):
        _create(client, bob, name="Bob's office")
        response = client.get("/devices/me/places", headers=_device_auth(client, alice))
        assert response.get_json()["places"] == []

    def test_a_revoked_phone_gets_nothing(self, client, alice):
        _create(client, alice)
        device = _device_auth(client, alice)
        client.post("/devices/me/revoke", headers=device)

        assert client.get("/devices/me/places", headers=device).status_code == 401

    def test_a_web_login_is_not_a_device_token(self, client, alice):
        assert client.get("/devices/me/places", headers=alice[1]).status_code == 401
