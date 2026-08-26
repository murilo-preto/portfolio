"""
Category administration tests

Covers the rename / delete / merge routes added for all three category
namespaces (time, finance, TODO) and the pure helpers in
flask-server/category_admin.py.

The helper tests need no database and run in the default tier. The route tests
are integration tests: they follow the conventions in test_flask_integration.py
and skip unless RUN_INTEGRATION_TESTS=true.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

import category_admin
from category_admin import NAMESPACES, clean_name, coerce_id


# ─── Unit tests (no database) ─────────────────────────────────────────────────


class TestNamespaceDefinitions:
    """The three namespaces are the only values ever interpolated into the SQL
    in category_admin, so pin them down."""

    def test_three_namespaces_are_registered(self):
        assert set(NAMESPACES) == {"time", "finance", "todo"}

    def test_tables_match_the_schema(self):
        assert category_admin.TIME.table == "category"
        assert category_admin.TIME.entry_table == "time_entries"
        assert category_admin.FINANCE.table == "finance_categories"
        assert category_admin.FINANCE.entry_table == "finance_entries"
        assert category_admin.TODO.table == "todo_categories"
        assert category_admin.TODO.entry_table == "todo_items"

    def test_only_finance_normalizes_names(self):
        assert category_admin.FINANCE.normalize is True
        assert category_admin.TIME.normalize is False
        assert category_admin.TODO.normalize is False


class TestCleanName:
    """Renames go through the same name handling as creates."""

    def test_trims_whitespace(self):
        assert clean_name(category_admin.TIME, "  Reading  ") == "Reading"

    def test_finance_names_are_normalized(self):
        assert clean_name(category_admin.FINANCE, "ALIMENTAÇÃO") == "Alimentação"

    def test_time_names_are_left_alone(self):
        assert clean_name(category_admin.TIME, "ALIMENTACAO") == "ALIMENTACAO"

    def test_non_strings_are_rejected(self):
        assert clean_name(category_admin.TIME, None) == ""
        assert clean_name(category_admin.TIME, 42) == ""

    def test_blank_stays_blank(self):
        assert clean_name(category_admin.FINANCE, "   ") == ""


class TestCoerceId:
    """Ids arrive from JSON bodies, so anything can turn up."""

    def test_accepts_int_and_numeric_string(self):
        assert coerce_id(7) == 7
        assert coerce_id("7") == 7

    def test_rejects_non_positive(self):
        assert coerce_id(0) is None
        assert coerce_id(-3) is None

    def test_rejects_junk(self):
        assert coerce_id(None) is None
        assert coerce_id("abc") is None
        assert coerce_id({"id": 1}) is None

    def test_rejects_booleans(self):
        """True is an int in Python; it is not a category id."""
        assert coerce_id(True) is None
        assert coerce_id(False) is None


# ─── Integration fixtures ─────────────────────────────────────────────────────


def _unique(prefix):
    return f"{prefix}_{datetime.now().timestamp()}"


@pytest.fixture(scope="module")
def test_app():
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")

    from app import app

    app.config["TESTING"] = True
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    with app.app_context():
        yield app


@pytest.fixture(scope="module")
def client(test_app):
    with test_app.test_client() as client:
        yield client


def _register_and_login(client, prefix):
    """A fresh user plus its Authorization header."""
    username = _unique(prefix)
    password = "categorypass123"

    registered = client.post(
        "/register", json={"username": username, "password": password}
    )
    if registered.status_code != 201:
        pytest.skip("Registration failed")

    logged_in = client.post(
        "/login", json={"username": username, "password": password}
    )
    if logged_in.status_code != 200:
        pytest.skip("Login failed")

    token = logged_in.get_json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owner(client):
    """The user whose categories the tests operate on."""
    return _register_and_login(client, "cat_owner")


@pytest.fixture(scope="module")
def intruder(client):
    """A second user, used to prove one user cannot reach another's entries."""
    return _register_and_login(client, "cat_intruder")


def _create_category(client, headers, name):
    response = client.post("/category", headers=headers, json={"name": name})
    assert response.status_code in (200, 201)
    return response.get_json()["category"]["id"]


def _create_time_entry(client, headers, category_name):
    # /entry/create requires ISO 8601 with an offset.
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    response = client.post(
        "/entry/create",
        headers=headers,
        json={
            "category": category_name,
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()["entry"]["id"]


def _usage_for(client, headers, category_id):
    response = client.get("/category/usage", headers=headers)
    assert response.status_code == 200
    for row in response.get_json()["categories"]:
        if row["id"] == category_id:
            return row
    return None


# ─── Auth ─────────────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestCategoryAdminRequiresAuth:
    """Every administration route is behind @jwt_required()."""

    @pytest.mark.parametrize(
        "method,path",
        [
            ("get", "/category/usage"),
            ("put", "/category/1"),
            ("delete", "/category/1"),
            ("post", "/category/1/merge"),
            ("get", "/finance/category/usage"),
            ("put", "/finance/category/1"),
            ("delete", "/finance/category/1"),
            ("post", "/finance/category/1/merge"),
            ("get", "/todo/category/usage"),
            ("put", "/todo/category/1"),
            ("delete", "/todo/category/1"),
            ("post", "/todo/category/1/merge"),
        ],
    )
    def test_rejects_anonymous(self, client, method, path):
        response = getattr(client, method)(path, json={"name": "x", "into": 1})
        assert response.status_code in (401, 422)


# ─── Usage counts ─────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestCategoryUsage:
    def test_usage_lists_categories_with_counts(self, client, owner):
        name = _unique("Usage")
        category_id = _create_category(client, owner, name)

        row = _usage_for(client, owner, category_id)
        assert row is not None
        assert row["name"] == name
        assert row["mine"] == 0
        assert row["others"] == 0

        _create_time_entry(client, owner, name)

        row = _usage_for(client, owner, category_id)
        assert row["mine"] == 1

    def test_other_users_entries_count_as_others(self, client, owner, intruder):
        name = _unique("Shared")
        category_id = _create_category(client, owner, name)
        _create_time_entry(client, intruder, name)

        mine_view = _usage_for(client, owner, category_id)
        assert mine_view["mine"] == 0
        assert mine_view["others"] == 1

        their_view = _usage_for(client, intruder, category_id)
        assert their_view["mine"] == 1
        assert their_view["others"] == 0

    def test_finance_and_todo_usage_endpoints_answer(self, client, owner):
        for path in ("/finance/category/usage", "/todo/category/usage"):
            response = client.get(path, headers=owner)
            assert response.status_code == 200
            assert isinstance(response.get_json()["categories"], list)


# ─── Rename ───────────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestRenameCategory:
    def test_renames_an_unused_category(self, client, owner):
        category_id = _create_category(client, owner, _unique("Typpo"))
        fixed = _unique("Typo")

        response = client.put(
            f"/category/{category_id}", headers=owner, json={"name": fixed}
        )

        assert response.status_code == 200
        assert response.get_json()["category"]["name"] == fixed
        assert _usage_for(client, owner, category_id)["name"] == fixed

    def test_rename_follows_the_users_own_entries(self, client, owner):
        original = _unique("Renameable")
        category_id = _create_category(client, owner, original)
        _create_time_entry(client, owner, original)

        renamed = _unique("Renamed")
        response = client.put(
            f"/category/{category_id}", headers=owner, json={"name": renamed}
        )

        assert response.status_code == 200
        row = _usage_for(client, owner, category_id)
        assert row["name"] == renamed
        assert row["mine"] == 1

    def test_collision_returns_409_not_500(self, client, owner):
        """The UNIQUE index used to surface as an opaque server error."""
        taken = _unique("Taken")
        _create_category(client, owner, taken)
        other_id = _create_category(client, owner, _unique("Other"))

        response = client.put(
            f"/category/{other_id}", headers=owner, json={"name": taken}
        )

        assert response.status_code == 409
        assert "already exists" in response.get_json()["error"]

    def test_missing_name_is_400(self, client, owner):
        category_id = _create_category(client, owner, _unique("NoName"))
        response = client.put(f"/category/{category_id}", headers=owner, json={})
        assert response.status_code == 400

    def test_blank_name_is_400(self, client, owner):
        category_id = _create_category(client, owner, _unique("Blank"))
        response = client.put(
            f"/category/{category_id}", headers=owner, json={"name": "   "}
        )
        assert response.status_code == 400

    def test_unknown_category_is_404(self, client, owner):
        response = client.put(
            "/category/99999999", headers=owner, json={"name": "Nope"}
        )
        assert response.status_code == 404

    def test_finance_rename_normalizes(self, client, owner):
        created = client.post(
            "/finance/category", headers=owner, json={"name": _unique("Fin")}
        )
        assert created.status_code in (200, 201)
        category_id = created.get_json()["category"]["id"]

        shouted = f"MERCADO {datetime.now().timestamp()}".replace(".", "")
        response = client.put(
            f"/finance/category/{category_id}", headers=owner, json={"name": shouted}
        )

        assert response.status_code == 200
        # "MERCADO 1234" -> "Mercado 1234": all-caps words of 3+ letters get
        # re-cased, digits are left alone.
        assert response.get_json()["category"]["name"].startswith("Mercado ")


# ─── Delete ───────────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestDeleteCategory:
    def test_deletes_an_unused_category(self, client, owner):
        category_id = _create_category(client, owner, _unique("Disposable"))

        response = client.delete(f"/category/{category_id}", headers=owner)

        assert response.status_code == 200
        assert _usage_for(client, owner, category_id) is None

    def test_in_use_category_is_refused_with_a_count(self, client, owner):
        """The FK is ON DELETE RESTRICT — the refusal has to be explained, not
        surfaced as a 500."""
        name = _unique("InUse")
        category_id = _create_category(client, owner, name)
        _create_time_entry(client, owner, name)

        response = client.delete(f"/category/{category_id}", headers=owner)

        assert response.status_code == 409
        body = response.get_json()
        assert body["usage"]["mine"] == 1
        assert _usage_for(client, owner, category_id) is not None

    def test_reassign_moves_entries_then_deletes(self, client, owner):
        doomed_name = _unique("Doomed")
        doomed_id = _create_category(client, owner, doomed_name)
        keeper_id = _create_category(client, owner, _unique("Keeper"))
        _create_time_entry(client, owner, doomed_name)

        response = client.delete(
            f"/category/{doomed_id}", headers=owner, json={"reassign_to": keeper_id}
        )

        assert response.status_code == 200
        assert response.get_json()["reassigned"] == 1
        assert _usage_for(client, owner, doomed_id) is None
        assert _usage_for(client, owner, keeper_id)["mine"] == 1

    def test_reassign_to_unknown_category_is_404(self, client, owner):
        name = _unique("Stubborn")
        category_id = _create_category(client, owner, name)
        _create_time_entry(client, owner, name)

        response = client.delete(
            f"/category/{category_id}", headers=owner, json={"reassign_to": 99999999}
        )

        assert response.status_code == 404
        assert _usage_for(client, owner, category_id) is not None

    def test_reassign_to_self_is_400(self, client, owner):
        name = _unique("SelfRef")
        category_id = _create_category(client, owner, name)
        _create_time_entry(client, owner, name)

        response = client.delete(
            f"/category/{category_id}", headers=owner, json={"reassign_to": category_id}
        )

        assert response.status_code == 400

    def test_unknown_category_is_404(self, client, owner):
        response = client.delete("/category/99999999", headers=owner)
        assert response.status_code == 404


# ─── Merge ────────────────────────────────────────────────────────────────────


@pytest.mark.integration
class TestMergeCategory:
    def test_merge_moves_entries_and_drops_the_source(self, client, owner):
        source_name = _unique("Source")
        source_id = _create_category(client, owner, source_name)
        target_id = _create_category(client, owner, _unique("Target"))
        _create_time_entry(client, owner, source_name)
        _create_time_entry(client, owner, source_name)

        response = client.post(
            f"/category/{source_id}/merge", headers=owner, json={"into": target_id}
        )

        assert response.status_code == 200
        assert response.get_json()["moved"] == 2
        assert _usage_for(client, owner, source_id) is None
        assert _usage_for(client, owner, target_id)["mine"] == 2

    def test_merge_into_self_is_400(self, client, owner):
        category_id = _create_category(client, owner, _unique("Loop"))
        response = client.post(
            f"/category/{category_id}/merge", headers=owner, json={"into": category_id}
        )
        assert response.status_code == 400

    def test_merge_without_target_is_400(self, client, owner):
        category_id = _create_category(client, owner, _unique("NoTarget"))
        response = client.post(f"/category/{category_id}/merge", headers=owner, json={})
        assert response.status_code == 400

    def test_merge_into_unknown_category_is_404(self, client, owner):
        category_id = _create_category(client, owner, _unique("Orphan"))
        response = client.post(
            f"/category/{category_id}/merge", headers=owner, json={"into": 99999999}
        )
        assert response.status_code == 404


# ─── Ownership / IDOR ─────────────────────────────────────────────────────────


@pytest.mark.integration
class TestCategoryOwnership:
    """The lookup tables have no user_id, so every operation has to check that
    nobody else's entries are riding on the category first."""

    def test_cannot_delete_a_category_another_user_is_using(
        self, client, owner, intruder
    ):
        name = _unique("Theirs")
        category_id = _create_category(client, owner, name)
        _create_time_entry(client, intruder, name)

        response = client.delete(f"/category/{category_id}", headers=owner)

        assert response.status_code == 409
        assert response.get_json()["usage"]["others"] == 1
        # And the other user's entry is untouched.
        assert _usage_for(client, intruder, category_id)["mine"] == 1

    def test_cannot_reassign_around_the_guard(self, client, owner, intruder):
        """Naming a replacement must not become a way to move someone else's
        entries out from under them."""
        name = _unique("TheirsToo")
        category_id = _create_category(client, owner, name)
        elsewhere_id = _create_category(client, owner, _unique("Elsewhere"))
        _create_time_entry(client, intruder, name)

        response = client.delete(
            f"/category/{category_id}",
            headers=owner,
            json={"reassign_to": elsewhere_id},
        )

        assert response.status_code == 409
        assert _usage_for(client, intruder, category_id)["mine"] == 1
        assert _usage_for(client, intruder, elsewhere_id)["mine"] == 0

    def test_cannot_merge_a_category_another_user_is_using(
        self, client, owner, intruder
    ):
        name = _unique("TheirsMerge")
        source_id = _create_category(client, owner, name)
        target_id = _create_category(client, owner, _unique("MergeTarget"))
        _create_time_entry(client, intruder, name)

        response = client.post(
            f"/category/{source_id}/merge", headers=owner, json={"into": target_id}
        )

        assert response.status_code == 409
        assert _usage_for(client, intruder, source_id)["mine"] == 1

    def test_cannot_rename_a_category_another_user_is_using(
        self, client, owner, intruder
    ):
        name = _unique("TheirsRename")
        category_id = _create_category(client, owner, name)
        _create_time_entry(client, intruder, name)

        response = client.put(
            f"/category/{category_id}", headers=owner, json={"name": _unique("Hijack")}
        )

        assert response.status_code == 409
        assert _usage_for(client, intruder, category_id)["name"] == name

    def test_merge_only_moves_the_callers_entries(self, client, owner, intruder):
        """The owner's merge of a category they share the *target* of must not
        disturb the other user's rows in that target."""
        source_name = _unique("MineOnly")
        target_name = _unique("SharedTarget")
        source_id = _create_category(client, owner, source_name)
        target_id = _create_category(client, owner, target_name)
        _create_time_entry(client, owner, source_name)
        _create_time_entry(client, intruder, target_name)

        response = client.post(
            f"/category/{source_id}/merge", headers=owner, json={"into": target_id}
        )

        assert response.status_code == 200
        assert _usage_for(client, owner, target_id)["mine"] == 1
        assert _usage_for(client, intruder, target_id)["mine"] == 1
