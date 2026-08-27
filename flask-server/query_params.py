"""
Query parameters for the list endpoints.

`GET /entry`, `GET /finance` and `GET /todo` each used to dump the caller's
entire table, leaving every filter, search and sort to the browser. That works
at a few hundred rows and stops working well before a few thousand.

This module is the shared parsing and SQL-building layer for
`?from=&to=&category=&q=&sort=&direction=&limit=&offset=`.

Two rules shape the whole design:

1. **Absent means unchanged.** A request with no parameters must produce
   exactly the response it produced before this module existed — same rows,
   same order, no pagination. The dashboards still download the full list and
   compute their totals in the browser, and they must keep working untouched.

2. **A parameter we cannot honour is an error, never a shrug.** Silently
   dropping a filter the caller typo'd shows them the wrong rows and tells them
   nothing. Every failure here raises QueryParamError, which the endpoints turn
   into a 400 naming the offending parameter.

Column names never come from the caller: `sort` is looked up in a whitelist the
endpoint owns, and everything else is a bound parameter.
"""

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

# Above this a "page" stops being a page. Callers that genuinely want
# everything already have the no-parameter form, which is unpaginated.
MAX_LIMIT = 500

MAX_SEARCH_LENGTH = 100

VALID_DIRECTIONS = ("asc", "desc")


class QueryParamError(ValueError):
    """A caller-fixable problem with the query string; becomes a 400."""


@dataclass(frozen=True)
class ListQuery:
    """One parsed query string. Every field is None/0 when not supplied."""

    date_from: datetime | None = None
    date_to: datetime | None = None
    category: str | None = None
    search: str | None = None
    sort: str | None = None
    direction: str = "asc"
    limit: int | None = None
    offset: int = 0

    @property
    def paginated(self) -> bool:
        """True when the caller asked for a window rather than everything."""
        return self.limit is not None

    @property
    def filtered(self) -> bool:
        return any(
            value is not None
            for value in (self.date_from, self.date_to, self.category, self.search)
        )


def escape_like(value: str) -> str:
    """Neutralise LIKE wildcards in user input.

    Without this, searching for "50%" matches every row and searching for "a_b"
    matches "axb" — the search silently means something other than what was
    typed. The backslash must be escaped first or it would escape the escapes.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _parse_bound(raw: str, name: str, *, inclusive_end: bool) -> datetime:
    """Read a date or datetime bound, always landing on an aware UTC value.

    A bare date is the common case from a date picker. `to=2026-08-27` means
    "through the end of the 27th" — treating it as midnight would silently drop
    that whole day's rows, which is the kind of bug nobody reports because the
    numbers merely look small.
    """
    text = raw.strip()
    if not text:
        raise QueryParamError(f"{name} must not be blank")

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise QueryParamError(
            f"{name} must be an ISO 8601 date or datetime (YYYY-MM-DD or "
            "YYYY-MM-DDTHH:MM:SS with offset)"
        )

    # A date-only bound has no time component to have been parsed.
    date_only = parsed.time() == time(0, 0) and "T" not in text and " " not in text
    if date_only and inclusive_end:
        parsed = parsed + timedelta(days=1) - timedelta(microseconds=1)

    if parsed.tzinfo is None:
        # Naive input is read as UTC, which is what the columns hold. Stated
        # rather than implied, because guessing the caller's zone would move
        # rows across day boundaries.
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_int(raw: str, name: str, *, minimum: int, maximum: int | None) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise QueryParamError(f"{name} must be an integer")
    if value < minimum:
        raise QueryParamError(f"{name} must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise QueryParamError(f"{name} must be at most {maximum}")
    return value


def parse_list_query(args, sortable) -> ListQuery:
    """Parse a request's query string against an endpoint's sort whitelist.

    `args` is request.args; `sortable` maps the public sort name to the SQL
    expression to order by — the endpoint owns both, so no caller-supplied text
    ever reaches the SQL.
    """
    date_from = None
    date_to = None
    if "from" in args:
        date_from = _parse_bound(args["from"], "from", inclusive_end=False)
    if "to" in args:
        date_to = _parse_bound(args["to"], "to", inclusive_end=True)
    if date_from and date_to and date_to < date_from:
        raise QueryParamError("to must not be earlier than from")

    category = None
    if "category" in args:
        category = args["category"].strip()
        if not category:
            raise QueryParamError("category must not be blank")

    search = None
    if "q" in args:
        search = args["q"].strip()
        if not search:
            raise QueryParamError("q must not be blank")
        if len(search) > MAX_SEARCH_LENGTH:
            raise QueryParamError(
                f"q must be at most {MAX_SEARCH_LENGTH} characters"
            )

    sort = None
    if "sort" in args:
        sort = args["sort"].strip()
        if sort not in sortable:
            allowed = ", ".join(sorted(sortable))
            raise QueryParamError(f"sort must be one of: {allowed}")

    direction = "asc"
    if "direction" in args:
        direction = args["direction"].strip().lower()
        if direction not in VALID_DIRECTIONS:
            raise QueryParamError("direction must be asc or desc")

    limit = None
    if "limit" in args:
        limit = _parse_int(args["limit"], "limit", minimum=1, maximum=MAX_LIMIT)

    offset = 0
    if "offset" in args:
        offset = _parse_int(args["offset"], "offset", minimum=0, maximum=None)
        if limit is None:
            raise QueryParamError("offset requires limit")

    return ListQuery(
        date_from=date_from,
        date_to=date_to,
        category=category,
        search=search,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )


def build_filters(query: ListQuery, *, date_column, category_column, search_columns):
    """Build the WHERE fragment for a parsed query.

    Returns (sql, params) where sql begins with " AND " when non-empty, so it
    appends directly to the endpoint's own `WHERE user_id = %s`. The user
    predicate stays with the endpoint deliberately: scoping rows to their owner
    is not a filter a query string gets a say in.
    """
    clauses = []
    params = []

    if query.date_from is not None:
        clauses.append(f"{date_column} >= %s")
        params.append(query.date_from)
    if query.date_to is not None:
        clauses.append(f"{date_column} <= %s")
        params.append(query.date_to)
    if query.category is not None:
        clauses.append(f"{category_column} = %s")
        params.append(query.category)
    if query.search is not None:
        pattern = f"%{escape_like(query.search)}%"
        matches = " OR ".join(f"{column} LIKE %s" for column in search_columns)
        clauses.append(f"({matches})")
        params.extend([pattern] * len(search_columns))

    if not clauses:
        return "", []
    return " AND " + " AND ".join(clauses), params


def build_order(query: ListQuery, sortable, default_order: str, tiebreaker: str) -> str:
    """Build the ORDER BY clause.

    With no `sort` the endpoint's original ordering is kept, so an
    unparameterised request returns the same rows in the same order it always
    did — the only difference is that ties are now broken deterministically
    instead of being left to the database.

    That tiebreaker is not cosmetic. Paging through rows sorted by a non-unique
    column (a category everything shares, two equal prices) without one lets
    the database hand back the same row on two pages and skip another entirely.
    `tiebreaker` is qualified by the caller because these queries join two
    tables that both have an `id`.
    """
    if query.sort is None:
        return f"ORDER BY {default_order}, {tiebreaker} ASC"
    column = sortable[query.sort]
    return f"ORDER BY {column} {query.direction.upper()}, {tiebreaker} ASC"


def build_page(query: ListQuery):
    """Build the LIMIT/OFFSET clause. Empty when the caller wants everything."""
    if not query.paginated:
        return "", []
    return "LIMIT %s OFFSET %s", [query.limit, query.offset]


def page_meta(query: ListQuery, total: int) -> dict:
    """The pagination block a windowed response carries alongside its rows."""
    return {
        "total": total,
        "limit": query.limit,
        "offset": query.offset,
        "has_more": query.offset + query.limit < total,
    }
