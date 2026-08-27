"""
List query tests

Covers the query parameters on GET /entry, GET /finance and GET /todo against
a real database: filtering, search, sorting and paging now happen in MySQL
rather than in the browser after the whole table has been downloaded.

The parsing layer itself is unit-tested in test_query_params.py. What matters
here is the behaviour only a real database can show — that LIKE escaping works,
that an inclusive `to` really includes its day, and that paging a list neither
repeats nor skips a row.

Every test here needs a database — importing app.py runs the migration runner,
which connects — so the module skips wholesale unless integration tests are on.
"""
import pytest
import sys
import os
from datetime import datetime, timedelta, timezone

pytestmark = pytest.mark.integration

if os.getenv("RUN_INTEGRATION_TESTS") != "true":
    pytest.skip(
        "Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true",
        allow_module_level=True,
    )

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

from app import app  # noqa: E402


# A fixed point well away from "now", so these rows never collide with the
# date windows other tests happen to use.
BASE = datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def test_app():
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-integration"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]
    with app.app_context():
        yield app


@pytest.fixture(scope="module")
def client(test_app):
    with test_app.test_client() as client:
        yield client


def auth(user):
    return {"Authorization": f"Bearer {user['token']}"}


@pytest.fixture
def make_user(client):
    def _make():
        username = f"lq_{datetime.now().timestamp()}"
        assert client.post(
            "/register", json={"username": username, "password": "testpass123"}
        ).status_code == 201
        login = client.post(
            "/login", json={"username": username, "password": "testpass123"}
        )
        assert login.status_code == 200
        return {"username": username, "token": login.get_json()["access_token"]}

    return _make


def make_category(client, user, name):
    response = client.post("/category", json={"name": name}, headers=auth(user))
    assert response.status_code in (200, 201), response.get_json()
    return name


def add_entry(client, user, category, start, minutes=60, note=None):
    body = {
        "category": category,
        "start_time": start.isoformat(),
        "end_time": (start + timedelta(minutes=minutes)).isoformat(),
    }
    if note is not None:
        body["note"] = note
    response = client.post("/entry/create", json=body, headers=auth(user))
    assert response.status_code == 201, response.get_json()
    return response.get_json()["entry"]["id"]


def entries(client, user, query=""):
    response = client.get(f"/entry{query}", headers=auth(user))
    assert response.status_code == 200, response.get_json()
    return response.get_json()


@pytest.fixture
def stocked(client, make_user):
    """A user with five entries across three days and two categories."""
    user = make_user()
    stamp = str(datetime.now().timestamp()).replace(".", "")
    work = make_category(client, user, f"Work{stamp}")
    rest = make_category(client, user, f"Rest{stamp}")

    ids = [
        add_entry(client, user, work, BASE, note="wrote the parser"),
        add_entry(client, user, work, BASE + timedelta(days=1), note="review"),
        add_entry(client, user, rest, BASE + timedelta(days=1, hours=3), note=None),
        add_entry(client, user, rest, BASE + timedelta(days=2), note="a 50% day"),
        add_entry(client, user, work, BASE + timedelta(days=2, hours=6), minutes=30),
    ]
    return {"user": user, "work": work, "rest": rest, "ids": ids}


class TestUnparameterisedIsUnchanged:
    """The contract that lets every existing dashboard keep working."""

    def test_returns_every_row(self, client, stocked):
        body = entries(client, stocked["user"])
        assert len(body["entries"]) == 5

    def test_keeps_the_original_oldest_first_order(self, client, stocked):
        # Asserted on ids rather than start_time: Flask serializes datetimes as
        # RFC 1123 ("Sun, 15 Mar 2026 12:00:00 GMT"), which does not sort
        # lexicographically. The fixture inserts in chronological order.
        body = entries(client, stocked["user"])
        assert [e["id"] for e in body["entries"]] == stocked["ids"]

    def test_carries_no_page_block(self, client, stocked):
        """An unpaginated response must not sprout pagination metadata."""
        assert "page" not in entries(client, stocked["user"])


class TestDateFiltering:
    def test_from_excludes_earlier_rows(self, client, stocked):
        body = entries(client, stocked["user"], "?from=2026-03-16")
        assert len(body["entries"]) == 4

    def test_to_includes_the_whole_final_day(self, client, stocked):
        """The bug this guards: `to=2026-03-16` dropping the 16th entirely."""
        body = entries(client, stocked["user"], "?to=2026-03-16")
        assert len(body["entries"]) == 3

    def test_a_single_day_window_is_that_day(self, client, stocked):
        body = entries(client, stocked["user"], "?from=2026-03-16&to=2026-03-16")
        assert len(body["entries"]) == 2

    def test_a_window_before_everything_is_empty(self, client, stocked):
        body = entries(client, stocked["user"], "?from=2020-01-01&to=2020-12-31")
        assert body["entries"] == []

    def test_inverted_range_is_a_400(self, client, stocked):
        response = client.get(
            "/entry?from=2026-03-20&to=2026-03-01", headers=auth(stocked["user"])
        )
        assert response.status_code == 400

    def test_unparseable_date_is_a_400(self, client, stocked):
        response = client.get(
            "/entry?from=yesterday", headers=auth(stocked["user"])
        )
        assert response.status_code == 400
        assert "from" in response.get_json()["error"]


class TestCategoryFiltering:
    def test_filters_to_one_category(self, client, stocked):
        body = entries(client, stocked["user"], f"?category={stocked['work']}")
        assert len(body["entries"]) == 3
        assert all(e["category"] == stocked["work"] for e in body["entries"])

    def test_unknown_category_is_empty_not_an_error(self, client, stocked):
        """Nothing matched is a result; only malformed input is an error."""
        body = entries(client, stocked["user"], "?category=NoSuchCategory")
        assert body["entries"] == []

    def test_blank_category_is_a_400(self, client, stocked):
        response = client.get("/entry?category=", headers=auth(stocked["user"]))
        assert response.status_code == 400


class TestSearch:
    def test_matches_a_note_substring(self, client, stocked):
        body = entries(client, stocked["user"], "?q=parser")
        assert len(body["entries"]) == 1
        assert body["entries"][0]["note"] == "wrote the parser"

    def test_matches_the_category_name_too(self, client, stocked):
        body = entries(client, stocked["user"], f"?q={stocked['rest']}")
        assert len(body["entries"]) == 2

    def test_percent_is_a_literal_not_a_wildcard(self, client, stocked):
        """Searching "50%" must not match everything."""
        body = entries(client, stocked["user"], "?q=50%25")
        assert len(body["entries"]) == 1
        assert body["entries"][0]["note"] == "a 50% day"

    def test_underscore_is_a_literal_not_a_single_char_wildcard(
        self, client, make_user
    ):
        user = make_user()
        stamp = str(datetime.now().timestamp()).replace(".", "")
        category = make_category(client, user, f"Cat{stamp}")
        add_entry(client, user, category, BASE, note="a_b")
        add_entry(client, user, category, BASE + timedelta(hours=2), note="axb")

        body = entries(client, user, "?q=a_b")
        assert len(body["entries"]) == 1
        assert body["entries"][0]["note"] == "a_b"

    def test_no_match_is_empty(self, client, stocked):
        assert entries(client, stocked["user"], "?q=zzzznothing")["entries"] == []

    def test_blank_search_is_a_400(self, client, stocked):
        response = client.get("/entry?q=%20", headers=auth(stocked["user"]))
        assert response.status_code == 400


class TestSorting:
    def test_sorts_by_category_descending(self, client, stocked):
        body = entries(
            client, stocked["user"], "?sort=category&direction=desc"
        )
        names = [e["category"] for e in body["entries"]]
        assert names == sorted(names, reverse=True)

    def test_sorts_by_duration(self, client, stocked):
        body = entries(client, stocked["user"], "?sort=duration&direction=asc")
        durations = [e["duration_seconds"] for e in body["entries"]]
        assert durations == sorted(durations)
        assert durations[0] == 1800

    def test_sorts_newest_first(self, client, stocked):
        body = entries(client, stocked["user"], "?sort=start_time&direction=desc")
        assert [e["id"] for e in body["entries"]] == list(reversed(stocked["ids"]))

    def test_unknown_sort_is_a_400_listing_the_options(self, client, stocked):
        response = client.get("/entry?sort=pwd_hash", headers=auth(stocked["user"]))
        assert response.status_code == 400
        assert "start_time" in response.get_json()["error"]

    def test_sql_injection_via_sort_is_refused(self, client, stocked):
        response = client.get(
            "/entry?sort=id;DROP%20TABLE%20users", headers=auth(stocked["user"])
        )
        assert response.status_code == 400
        # The table is very much still there.
        assert client.get("/entry", headers=auth(stocked["user"])).status_code == 200

    def test_bad_direction_is_a_400(self, client, stocked):
        response = client.get(
            "/entry?direction=random", headers=auth(stocked["user"])
        )
        assert response.status_code == 400


class TestPaging:
    def test_limit_caps_the_rows_returned(self, client, stocked):
        body = entries(client, stocked["user"], "?limit=2")
        assert len(body["entries"]) == 2

    def test_page_block_reports_the_full_total(self, client, stocked):
        body = entries(client, stocked["user"], "?limit=2")
        assert body["page"]["total"] == 5
        assert body["page"]["limit"] == 2
        assert body["page"]["offset"] == 0
        assert body["page"]["has_more"] is True

    def test_last_page_reports_no_more(self, client, stocked):
        body = entries(client, stocked["user"], "?limit=2&offset=4")
        assert len(body["entries"]) == 1
        assert body["page"]["has_more"] is False

    def test_paging_neither_repeats_nor_skips(self, client, stocked):
        """The reason every ordering carries an id tiebreaker."""
        seen = []
        for offset in (0, 2, 4):
            body = entries(client, stocked["user"], f"?limit=2&offset={offset}")
            seen.extend(e["id"] for e in body["entries"])
        assert len(seen) == len(set(seen)) == 5
        assert set(seen) == set(stocked["ids"])

    def test_paging_a_sorted_list_neither_repeats_nor_skips(self, client, stocked):
        """Sorting by a column three rows share is where naive paging breaks."""
        seen = []
        for offset in (0, 2, 4):
            body = entries(
                client,
                stocked["user"],
                f"?sort=category&direction=asc&limit=2&offset={offset}",
            )
            seen.extend(e["id"] for e in body["entries"])
        assert len(seen) == len(set(seen)) == 5

    def test_the_count_respects_the_filters(self, client, stocked):
        """A total that ignored the filter would page into an empty void."""
        body = entries(
            client, stocked["user"], f"?category={stocked['work']}&limit=2"
        )
        assert body["page"]["total"] == 3

    def test_offset_past_the_end_is_empty_not_an_error(self, client, stocked):
        body = entries(client, stocked["user"], "?limit=2&offset=500")
        assert body["entries"] == []
        assert body["page"]["has_more"] is False

    def test_offset_without_limit_is_a_400(self, client, stocked):
        response = client.get("/entry?offset=10", headers=auth(stocked["user"]))
        assert response.status_code == 400

    def test_limit_over_the_cap_is_a_400(self, client, stocked):
        response = client.get("/entry?limit=100000", headers=auth(stocked["user"]))
        assert response.status_code == 400


class TestFiltersNeverCrossUsers:
    """No parameter may widen the set beyond the caller's own rows."""

    def test_search_only_sees_your_own_entries(self, client, make_user, stocked):
        stranger = make_user()
        body = entries(client, stranger, "?q=parser")
        assert body["entries"] == []

    def test_category_filter_only_sees_your_own_entries(
        self, client, make_user, stocked
    ):
        """Categories are global, so this is the case that would leak."""
        stranger = make_user()
        body = entries(client, stranger, f"?category={stocked['work']}")
        assert body["entries"] == []

    def test_paging_only_sees_your_own_entries(self, client, make_user, stocked):
        stranger = make_user()
        body = entries(client, stranger, "?limit=50")
        assert body["page"]["total"] == 0


class TestFinanceQueries:
    """The same layer on /finance, over its own columns."""

    @pytest.fixture
    def stocked_finance(self, client, make_user):
        user = make_user()
        stamp = str(datetime.now().timestamp()).replace(".", "")
        category = f"Food{stamp}"
        assert client.post(
            "/finance/category", json={"name": category}, headers=auth(user)
        ).status_code in (200, 201)

        for name, price, day in (
            ("Coffee", 12.5, "2026-03-15T12:00:00+00:00"),
            ("Bread", 8.0, "2026-03-16T12:00:00+00:00"),
            ("Cheese", 45.0, "2026-03-17T12:00:00+00:00"),
        ):
            response = client.post(
                "/finance/create",
                json={
                    "category": category,
                    "product_name": name,
                    "price": price,
                    "purchase_date": day,
                },
                headers=auth(user),
            )
            assert response.status_code == 201, response.get_json()

        return {"user": user, "category": category}

    def get(self, client, user, query=""):
        response = client.get(f"/finance{query}", headers=auth(user))
        assert response.status_code == 200, response.get_json()
        return response.get_json()

    def test_unparameterised_returns_everything_newest_first(
        self, client, stocked_finance
    ):
        body = self.get(client, stocked_finance["user"])
        # Named rather than date-compared, for the RFC 1123 reason above.
        assert [e["product_name"] for e in body["entries"]] == [
            "Cheese",
            "Bread",
            "Coffee",
        ]

    def test_search_matches_the_product_name(self, client, stocked_finance):
        body = self.get(client, stocked_finance["user"], "?q=Coff")
        assert len(body["entries"]) == 1
        assert body["entries"][0]["product_name"] == "Coffee"

    def test_sorts_by_price(self, client, stocked_finance):
        body = self.get(
            client, stocked_finance["user"], "?sort=price&direction=asc"
        )
        prices = [e["price"] for e in body["entries"]]
        assert prices == sorted(prices)
        assert prices[0] == 8.0

    def test_date_window_is_inclusive_of_its_last_day(
        self, client, stocked_finance
    ):
        body = self.get(
            client, stocked_finance["user"], "?from=2026-03-16&to=2026-03-17"
        )
        assert len(body["entries"]) == 2

    def test_paging_reports_a_total(self, client, stocked_finance):
        body = self.get(client, stocked_finance["user"], "?limit=2")
        assert body["page"]["total"] == 3
        assert len(body["entries"]) == 2

    def test_unknown_sort_is_a_400(self, client, stocked_finance):
        response = client.get(
            "/finance?sort=user_id", headers=auth(stocked_finance["user"])
        )
        assert response.status_code == 400


class TestTodoQueries:
    """/todo carries two filters the other lists have no use for."""

    @pytest.fixture
    def stocked_todo(self, client, make_user):
        user = make_user()
        stamp = str(datetime.now().timestamp()).replace(".", "")
        category = f"Proj{stamp}"
        assert client.post(
            "/todo/category", json={"name": category}, headers=auth(user)
        ).status_code in (200, 201)

        ids = {}
        for title, priority in (
            ("Write the parser", "high"),
            ("Review the diff", "low"),
            ("Ship it", "medium"),
        ):
            response = client.post(
                "/todo/create",
                json={"title": title, "category": category, "priority": priority},
                headers=auth(user),
            )
            assert response.status_code == 201, response.get_json()
            ids[title] = response.get_json()["item"]["id"]

        client.put(
            f"/todo/{ids['Ship it']}",
            json={"status": "completed"},
            headers=auth(user),
        )
        return {"user": user, "category": category, "ids": ids}

    def get(self, client, user, query=""):
        response = client.get(f"/todo{query}", headers=auth(user))
        assert response.status_code == 200, response.get_json()
        return response.get_json()

    def test_unparameterised_keeps_the_priority_ordering(
        self, client, stocked_todo
    ):
        """high, medium, low — not the ENUM's alphabetical high, low, medium."""
        body = self.get(client, stocked_todo["user"])
        assert [i["priority"] for i in body["items"]] == ["high", "medium", "low"]

    def test_filters_by_status(self, client, stocked_todo):
        body = self.get(client, stocked_todo["user"], "?status=completed")
        assert len(body["items"]) == 1
        assert body["items"][0]["title"] == "Ship it"

    def test_filters_by_priority(self, client, stocked_todo):
        body = self.get(client, stocked_todo["user"], "?priority=high")
        assert len(body["items"]) == 1

    def test_status_and_priority_combine(self, client, stocked_todo):
        body = self.get(
            client, stocked_todo["user"], "?status=pending&priority=high"
        )
        assert len(body["items"]) == 1

    def test_bad_status_is_a_400(self, client, stocked_todo):
        response = client.get(
            "/todo?status=maybe", headers=auth(stocked_todo["user"])
        )
        assert response.status_code == 400

    def test_bad_priority_is_a_400(self, client, stocked_todo):
        response = client.get(
            "/todo?priority=urgent", headers=auth(stocked_todo["user"])
        )
        assert response.status_code == 400

    def test_search_matches_the_title(self, client, stocked_todo):
        body = self.get(client, stocked_todo["user"], "?q=parser")
        assert len(body["items"]) == 1

    def test_sort_by_priority_can_be_reversed(self, client, stocked_todo):
        body = self.get(
            client, stocked_todo["user"], "?sort=priority&direction=desc"
        )
        assert [i["priority"] for i in body["items"]] == ["low", "medium", "high"]

    def test_paged_items_still_carry_their_tags_and_focus(
        self, client, stocked_todo
    ):
        """The per-page follow-up queries must key off the page, not the table."""
        body = self.get(client, stocked_todo["user"], "?limit=2")
        assert len(body["items"]) == 2
        for item in body["items"]:
            assert item["tags"] == []
            assert item["focus_sessions"] == 0
