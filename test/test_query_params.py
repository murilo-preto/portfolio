"""
Query parameter tests

Covers flask-server/query_params.py, the parsing and SQL-building layer behind
`?from=&to=&category=&q=&sort=&direction=&limit=&offset=` on the three list
endpoints.

Pure unit tests — no database, no app import. The endpoints that use this
module are exercised against real MySQL in test_list_queries.py.
"""
import pytest
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

from query_params import (  # noqa: E402
    MAX_LIMIT,
    MAX_SEARCH_LENGTH,
    ListQuery,
    QueryParamError,
    build_filters,
    build_order,
    build_page,
    escape_like,
    page_meta,
    parse_list_query,
)


SORTABLE = {
    "start_time": "te.start_time",
    "category": "c.name",
}

DEFAULT_ORDER = "te.start_time ASC"


def parse(**args):
    return parse_list_query(args, SORTABLE)


class TestEmptyQuery:
    """No parameters must mean exactly what it meant before this module."""

    def test_empty_args_produce_an_empty_query(self):
        query = parse()
        assert query.date_from is None
        assert query.date_to is None
        assert query.category is None
        assert query.search is None
        assert query.sort is None
        assert query.limit is None
        assert query.offset == 0

    def test_empty_query_is_neither_filtered_nor_paginated(self):
        query = parse()
        assert not query.filtered
        assert not query.paginated

    def test_empty_query_builds_no_where_clause(self):
        where, params = build_filters(
            parse(),
            date_column="te.start_time",
            category_column="c.name",
            search_columns=("te.note",),
        )
        assert where == ""
        assert params == []

    def test_empty_query_keeps_the_endpoint_ordering(self):
        order = build_order(parse(), SORTABLE, DEFAULT_ORDER, "te.id")
        assert order == "ORDER BY te.start_time ASC, te.id ASC"

    def test_empty_query_builds_no_limit(self):
        sql, params = build_page(parse())
        assert sql == ""
        assert params == []


class TestDateBounds:
    def test_date_only_from_is_midnight_utc(self):
        query = parse(**{"from": "2026-08-27"})
        assert query.date_from == datetime(2026, 8, 27, tzinfo=timezone.utc)

    def test_date_only_to_covers_the_whole_day(self):
        """`to=2026-08-27` means through the 27th, not up to its midnight."""
        query = parse(to="2026-08-27")
        assert query.date_to.date() == datetime(2026, 8, 27).date()
        assert query.date_to.hour == 23
        assert query.date_to.minute == 59

    def test_explicit_datetime_to_is_taken_literally(self):
        query = parse(to="2026-08-27T09:00:00")
        assert query.date_to == datetime(2026, 8, 27, 9, 0, tzinfo=timezone.utc)

    def test_offset_is_converted_to_utc(self):
        query = parse(**{"from": "2026-08-27T09:00:00-03:00"})
        assert query.date_from == datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)

    def test_zulu_suffix_is_accepted(self):
        query = parse(**{"from": "2026-08-27T09:00:00Z"})
        assert query.date_from == datetime(2026, 8, 27, 9, 0, tzinfo=timezone.utc)

    def test_naive_datetime_is_read_as_utc(self):
        query = parse(**{"from": "2026-08-27T09:00:00"})
        assert query.date_from.tzinfo is timezone.utc

    def test_garbage_date_is_rejected(self):
        with pytest.raises(QueryParamError, match="from"):
            parse(**{"from": "last tuesday"})

    def test_blank_date_is_rejected(self):
        with pytest.raises(QueryParamError):
            parse(**{"from": "   "})

    def test_inverted_range_is_rejected(self):
        with pytest.raises(QueryParamError, match="earlier"):
            parse(**{"from": "2026-08-27", "to": "2026-08-01"})

    def test_same_day_range_is_accepted(self):
        """from and to on one day is a real request, not an inverted range."""
        query = parse(**{"from": "2026-08-27", "to": "2026-08-27"})
        assert query.date_from < query.date_to


class TestSearch:
    def test_search_is_trimmed(self):
        assert parse(q="  coffee  ").search == "coffee"

    def test_blank_search_is_rejected(self):
        with pytest.raises(QueryParamError, match="q"):
            parse(q="   ")

    def test_overlong_search_is_rejected(self):
        with pytest.raises(QueryParamError, match="at most"):
            parse(q="x" * (MAX_SEARCH_LENGTH + 1))

    def test_search_at_the_limit_is_accepted(self):
        assert len(parse(q="x" * MAX_SEARCH_LENGTH).search) == MAX_SEARCH_LENGTH


class TestEscapeLike:
    """A search box that quietly means something else is worse than none."""

    def test_percent_is_escaped(self):
        assert escape_like("50%") == "50\\%"

    def test_underscore_is_escaped(self):
        assert escape_like("a_b") == "a\\_b"

    def test_backslash_is_escaped_first(self):
        """Escaping it last would escape the escapes we just added."""
        assert escape_like("a\\%b") == "a\\\\\\%b"

    def test_ordinary_text_is_untouched(self):
        assert escape_like("coffee beans") == "coffee beans"


class TestSort:
    def test_known_sort_is_accepted(self):
        assert parse(sort="category").sort == "category"

    def test_unknown_sort_is_rejected_and_lists_the_options(self):
        with pytest.raises(QueryParamError, match="category, start_time"):
            parse(sort="password")

    def test_sql_in_sort_is_rejected(self):
        """Column names come from the whitelist, never from the caller."""
        with pytest.raises(QueryParamError):
            parse(sort="te.id; DROP TABLE users")

    def test_direction_defaults_to_asc(self):
        assert parse().direction == "asc"

    def test_direction_is_case_insensitive(self):
        assert parse(direction="DESC").direction == "desc"

    def test_bad_direction_is_rejected(self):
        with pytest.raises(QueryParamError, match="asc or desc"):
            parse(direction="sideways")

    def test_explicit_sort_replaces_the_default_order(self):
        order = build_order(
            parse(sort="category", direction="desc"),
            SORTABLE,
            DEFAULT_ORDER,
            "te.id",
        )
        assert order == "ORDER BY c.name DESC, te.id ASC"

    def test_every_ordering_carries_a_tiebreaker(self):
        """Without one, paging over a non-unique sort repeats and skips rows."""
        for query in (parse(), parse(sort="category")):
            assert build_order(query, SORTABLE, DEFAULT_ORDER, "te.id").endswith(
                "te.id ASC"
            )


class TestPaging:
    def test_limit_is_parsed(self):
        assert parse(limit="25").limit == 25

    def test_limit_is_capped(self):
        with pytest.raises(QueryParamError, match="at most"):
            parse(limit=str(MAX_LIMIT + 1))

    def test_zero_limit_is_rejected(self):
        with pytest.raises(QueryParamError, match="at least"):
            parse(limit="0")

    def test_non_integer_limit_is_rejected(self):
        with pytest.raises(QueryParamError, match="integer"):
            parse(limit="lots")

    def test_negative_offset_is_rejected(self):
        with pytest.raises(QueryParamError, match="at least"):
            parse(limit="10", offset="-1")

    def test_offset_without_limit_is_rejected(self):
        """An offset into an unpaginated list means nothing."""
        with pytest.raises(QueryParamError, match="requires limit"):
            parse(offset="10")

    def test_page_sql_binds_both_values(self):
        sql, params = build_page(parse(limit="10", offset="20"))
        assert sql == "LIMIT %s OFFSET %s"
        assert params == [10, 20]


class TestBuildFilters:
    def build(self, query):
        return build_filters(
            query,
            date_column="te.start_time",
            category_column="c.name",
            search_columns=("te.note", "c.name"),
        )

    def test_clauses_append_to_an_existing_where(self):
        where, _ = self.build(parse(category="Work"))
        assert where.startswith(" AND ")

    def test_category_is_a_bound_parameter(self):
        where, params = self.build(parse(category="Work"))
        assert where == " AND c.name = %s"
        assert params == ["Work"]

    def test_search_covers_every_named_column(self):
        where, params = self.build(parse(q="tea"))
        assert where == " AND (te.note LIKE %s OR c.name LIKE %s)"
        assert params == ["%tea%", "%tea%"]

    def test_search_wildcards_are_escaped_into_the_pattern(self):
        _, params = self.build(parse(q="50%"))
        assert params == ["%50\\%%", "%50\\%%"]

    def test_bounds_become_two_clauses_in_order(self):
        where, params = self.build(
            parse(**{"from": "2026-08-01", "to": "2026-08-31"})
        )
        assert where == " AND te.start_time >= %s AND te.start_time <= %s"
        assert params[0] < params[1]

    def test_everything_combines_with_and(self):
        where, params = self.build(
            parse(**{"from": "2026-08-01", "category": "Work", "q": "tea"})
        )
        assert where.count(" AND ") == 3
        assert len(params) == 4


class TestPageMeta:
    def test_has_more_when_rows_remain(self):
        meta = page_meta(ListQuery(limit=50, offset=0), total=120)
        assert meta["has_more"] is True
        assert meta["total"] == 120

    def test_no_more_on_the_last_page(self):
        assert page_meta(ListQuery(limit=50, offset=100), total=120)["has_more"] is False

    def test_no_more_on_an_exact_fit(self):
        """50 of 50 is the end, not a page boundary with an empty page after."""
        assert page_meta(ListQuery(limit=50, offset=0), total=50)["has_more"] is False
