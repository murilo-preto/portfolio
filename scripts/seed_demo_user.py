"""Seed a demo account with a month of realistic data, for eyeballing themes.

Run it through ./seed_demo_user.sh, which pipes this file into the running
Flask container — stdlib only, so it needs nothing the image lacks.

It goes through the public API rather than the database, so everything it
writes passes the same validation a real client's data would. Creates:

- ~80 time entries over the last four weeks, in eight categories (enough to
  show every `--chart-N` series)
- ~64 finance entries over four months: done in the past, planned ahead
- ten todos across priorities, due dates (one overdue), recurrence and tags,
  three of them moved to in progress / completed
- the requested theme and dark style, saved as the account's preferences
"""

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--username", default="theme-demo")
parser.add_argument("--password", default="themedemo123")
parser.add_argument("--theme", default="dark", choices=["system", "light", "dark"])
parser.add_argument(
    "--dark-style", default="glass", choices=["default", "oled", "glass"]
)
parser.add_argument("--base-url", default="http://localhost:3000")
# The container's clock is UTC; the wrapper passes the host's offset so a
# "9:00 work block" lands at 9:00 on your calendar, not three hours off.
parser.add_argument("--utc-offset", default="+00:00", help="e.g. --utc-offset=-03:00")
args = parser.parse_args()

# The default limit is 20/minute per account. Pace under it unless limiting is
# off, as it is in the test stack.
RATE_LIMITED = os.getenv("RATELIMIT_ENABLED", "true").lower() != "false"
PACE = 3.3 if RATE_LIMITED else 0

# Flask refuses naive timestamps; send ISO 8601 with the caller's offset.
_sign = -1 if args.utc_offset.startswith("-") else 1
_hours, _minutes = args.utc_offset.lstrip("+-").split(":")
LOCAL_TZ = timezone(_sign * timedelta(hours=int(_hours), minutes=int(_minutes)))

random.seed(7)  # same data on every run, so screenshots are comparable
token = None


def call(method, path, body=None):
    if token and PACE:
        time.sleep(PACE)
    req = urllib.request.Request(
        args.base_url + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def fail(step, status, body):
    sys.exit(f"{step} failed ({status}): {body}")


def fmt(dt):
    return dt.replace(tzinfo=LOCAL_TZ).isoformat(timespec="seconds")


def at(day, hours):
    return datetime.combine(day, datetime.min.time()) + timedelta(hours=hours)


def check_batch(step, status, body, verb="created"):
    if status != 200 or body.get("failed"):
        fail(step, status, body)
    print(f"  {step}: {body['success']} {verb}")


# ── Account ──────────────────────────────────────────────────────────────────

status, body = call(
    "POST", "/register", {"username": args.username, "password": args.password}
)
if status == 409:
    # Seeding twice would duplicate every entry, and there is no endpoint to
    # delete an account, so refuse rather than half-reseed.
    sys.exit(
        f"User '{args.username}' already exists. Pass --username to seed a "
        "fresh one."
    )
if status != 201:
    fail("register", status, body)

status, body = call(
    "POST", "/login", {"username": args.username, "password": args.password}
)
if status != 200:
    fail("login", status, body)
token = body["access_token"]
print(f"Seeding '{args.username}'" + (" (paced for the rate limit)" if PACE else ""))

today = datetime.now(LOCAL_TZ).date()

# ── Time entries: four weeks ending today ───────────────────────────────────

blocks = [
    # (category, start hour, hours, weekdays only, probability)
    ("Work", 9, 4, True, 0.95),
    ("Work", 14, 3.5, True, 0.9),
    ("Study", 19, 1.5, True, 0.6),
    ("Exercise", 7, 1, False, 0.55),
    ("Reading", 22, 0.75, False, 0.6),
    ("Side project", 20.5, 1.5, False, 0.35),
    ("Music", 18, 1, False, 0.3),
    ("Errands", 11, 1.5, False, 0.25),
]
notes = {
    "Work": ["Sprint planning", "Code review", "Deploy prep", None, None],
    "Study": ["Distributed systems ch. 4", "Spanish practice", None],
    "Exercise": ["Run 5k", "Gym", "Yoga"],
    "Reading": ["Novel", None],
    "Side project": ["Theme picker", "Mobile app", None],
    "Music": ["Guitar", None],
    "Errands": ["Groceries", "Bank", None],
}

entries = []
day = today - timedelta(days=today.weekday(), weeks=3)
now = datetime.now(LOCAL_TZ).replace(tzinfo=None)
while day <= today:
    weekend = day.weekday() >= 5
    for category, hour, hours, weekdays_only, p in blocks:
        if weekdays_only and weekend:
            continue
        if weekend and category == "Errands":
            p = 0.6
        if random.random() > p:
            continue
        start = at(day, hour + random.choice([0, 0, 0.25, -0.25]))
        end = start + timedelta(hours=hours * random.uniform(0.8, 1.15))
        if end > now:
            continue
        entry = {"category": category, "start_time": fmt(start), "end_time": fmt(end)}
        note = random.choice(notes[category])
        if note:
            entry["note"] = note
        entries.append(entry)
    day += timedelta(days=1)

check_batch("time entries", *call("POST", "/entry/batch-import", {"entries": entries}))

# ── Finance: two months back to one ahead ───────────────────────────────────

finance_items = [
    # (category, item, fixed price or None for a random one, days of month)
    ("Rent", "Apartment rent", 2400, [1]),
    ("Groceries", "Supermarket", None, [3, 10, 17, 24]),
    ("Transport", "Metro card", 180, [2]),
    ("Transport", "Ride home", None, [8, 21]),
    ("Dining", "Dinner out", None, [6, 13, 27]),
    ("Subscriptions", "Music streaming", 34.9, [5]),
    ("Subscriptions", "Cloud storage", 9.9, [12]),
    ("Health", "Pharmacy", None, [15]),
    ("Leisure", "Cinema", None, [19]),
    ("Utilities", "Electricity", None, [10]),
]
this_month = today.replace(day=1)
months = [
    (this_month - timedelta(days=40)).replace(day=1),
    (this_month - timedelta(days=5)).replace(day=1),
    this_month,
    (this_month + timedelta(days=40)).replace(day=1),
]
finance = []
for month in months:
    for category, name, price, days in finance_items:
        for d in days:
            when = at(month.replace(day=d), 12)
            finance.append(
                {
                    "category": category,
                    "product_name": name,
                    "price": price if price is not None else round(random.uniform(25, 320), 2),
                    "purchase_date": fmt(when),
                    "status": "done" if when.date() <= today else "planned",
                }
            )

check_batch("finance entries", *call("POST", "/finance/batch-import", {"entries": finance}))

# ── Todos ────────────────────────────────────────────────────────────────────


def due(days, hour=18):
    return fmt(at(today + timedelta(days=days), hour))


# Categories are the four every account is seeded with (categories.py).
todos = [
    {"title": "Ship the theme picker", "category": "Work", "priority": "high",
     "due_date": due(1), "tags": ["frontend", "release"],
     "description": "Glass and OLED styles, chart palettes per theme."},
    {"title": "Review pairing endpoint PR", "category": "Work", "priority": "medium",
     "due_date": due(2), "tags": ["review"]},
    {"title": "Renew passport", "category": "Personal", "priority": "high",
     "due_date": due(-1), "tags": ["admin"]},
    {"title": "Weekly review", "category": "Personal", "priority": "low",
     "due_date": due(4, 20), "recurrence_rule": "weekly"},
    {"title": "Read chapter 5", "category": "Study", "priority": "medium",
     "due_date": due(3, 21), "tags": ["reading"]},
    {"title": "Spanish flashcards", "category": "Study", "priority": "low",
     "recurrence_rule": "daily"},
    {"title": "Buy coffee beans", "category": "Shopping", "priority": "low",
     "tags": ["home"]},
    {"title": "New running shoes", "category": "Shopping", "priority": "medium",
     "due_date": due(10)},
    {"title": "Pay electricity bill", "category": "Personal", "priority": "high",
     "due_date": due(5), "recurrence_rule": "monthly", "tags": ["admin"]},
    {"title": "Write release notes", "category": "Work", "priority": "medium",
     "due_date": due(0, 17), "tags": ["release"]},
]
ids = {}
for todo in todos:
    status, body = call("POST", "/todo/create", todo)
    if status != 201:
        fail(f"todo '{todo['title']}'", status, body)
    ids[todo["title"]] = body["item"]["id"]
print(f"  todos: {len(ids)} created")

status, body = call(
    "POST",
    "/todo/bulk-update",
    {
        "updates": [
            {"item_id": ids["Review pairing endpoint PR"], "status": "in_progress"},
            {"item_id": ids["Buy coffee beans"], "status": "completed"},
            {"item_id": ids["Write release notes"], "status": "completed"},
        ]
    },
)
check_batch("todo statuses", status, body, verb="updated")

# ── Preferences ──────────────────────────────────────────────────────────────

status, body = call(
    "PUT",
    "/user/preferences",
    {
        "theme": args.theme,
        "settings": {"themeStyles": {"light": "paper", "dark": args.dark_style}},
    },
)
if status != 200:
    fail("preferences", status, body)
print(f"  preferences: theme {args.theme}, dark style {args.dark_style}")

print(
    f"\nDone. Log in at http://localhost:5000 as {args.username} / {args.password}"
)
