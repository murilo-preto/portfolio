import os
import requests
import random
import sys
import time
from datetime import datetime, timedelta, timezone

API_HOST = os.getenv("API_HOST", "localhost")
API_PORT = os.getenv("PORT", "3000")
BASE_URL = f"http://{API_HOST}:{API_PORT}"

DEFAULT_PASSWORD = os.getenv("SEED_USER_PASSWORD", "password123")

USERS = ["alice"]
CATEGORIES = ["Work", "Study", "Exercise", "Reading"]
FINANCE_CATEGORIES = ["Groceries", "Utilities", "Entertainment", "Shopping", "Transport", "Healthcare"]

ENTRIES_PER_USER = 12
FINANCE_ENTRIES_PER_USER = 50
DAYS_SPAN = 30

# Flask applies a default 20/minute rate limit. Seeding sends far more requests
# than that, so back off and retry instead of dropping rows on the floor.
RETRY_ATTEMPTS = 6
RETRY_WAIT_SECONDS = 15


def post(path, payload, token=None):
    """
    POST to the API, retrying while the rate limiter rejects us.
    """
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    for attempt in range(RETRY_ATTEMPTS):
        response = requests.post(f"{BASE_URL}{path}", json=payload, headers=headers)

        if response.status_code != 429:
            return response

        if attempt < RETRY_ATTEMPTS - 1:
            wait = int(response.headers.get("Retry-After", RETRY_WAIT_SECONDS))
            print(f"Rate limited on {path}, retrying in {wait}s...")
            time.sleep(wait)

    print(
        f"Still rate limited on {path} after {RETRY_ATTEMPTS} attempts. "
        "Set RATELIMIT_ENABLED=false in .env and restart the flask service "
        "to seed without throttling."
    )
    return response


def to_iso_utc(dt: datetime) -> str:
    """
    Ensure datetime is UTC and return ISO 8601 string with Z.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def random_datetime_within_week() -> datetime:
    """
    Returns timezone-aware UTC datetime within the last DAYS_SPAN days.
    """
    now = datetime.now(timezone.utc)
    start_window = now - timedelta(days=DAYS_SPAN)

    random_seconds = random.randint(0, DAYS_SPAN * 24 * 3600)
    return start_window + timedelta(seconds=random_seconds)


def register_user(username):
    response = post("/register", {"username": username, "password": DEFAULT_PASSWORD})

    if response.status_code == 409:
        print(f"Register {username}: already exists, reusing")
    else:
        print(f"Register {username}: {response.status_code}")


def get_auth_token(username):
    """Login and get access token for a user."""
    response = post("/login", {"username": username, "password": DEFAULT_PASSWORD})
    if response.status_code == 200:
        return response.json().get("access_token")

    print(f"Login {username} failed:", response.status_code, response.text)
    return None


def create_category(token, name):
    response = post("/category", {"name": name}, token)
    print(f"Category {name}: {response.status_code}")


def create_finance_category(token, name):
    response = post("/finance/category", {"name": name}, token)
    print(f"Finance category {name}: {response.status_code}")


def create_entry(token, category, start_time, end_time):
    response = post(
        "/entry/create",
        {
            "category": category,
            "start_time": to_iso_utc(start_time),
            "end_time": to_iso_utc(end_time),
        },
        token,
    )

    if response.status_code != 201:
        print("Entry error:", response.status_code, response.text)


def create_finance_entry(token, product_name, category, price, purchase_date, status="planned"):
    response = post(
        "/finance/create",
        {
            "product_name": product_name,
            "category": category,
            "price": price,
            "purchase_date": to_iso_utc(purchase_date),
            "status": status,
        },
        token,
    )

    if response.status_code != 201:
        print("Finance entry error:", response.status_code, response.text)


def seed():
    print(f"Seeding API at {BASE_URL}")

    print("Creating users...")
    for user in USERS:
        register_user(user)

    tokens = {}
    for user in USERS:
        token = get_auth_token(user)
        if token:
            tokens[user] = token

    if not tokens:
        print("No user could be authenticated, aborting.")
        sys.exit(1)

    # Categories are global, so any authenticated user can create them.
    setup_token = next(iter(tokens.values()))

    print("Creating categories...")
    for category in CATEGORIES:
        create_category(setup_token, category)

    print("Creating finance categories...")
    for category in FINANCE_CATEGORIES:
        create_finance_category(setup_token, category)

    print("Creating time entries...")
    for user, token in tokens.items():
        for _ in range(ENTRIES_PER_USER):
            start_time = random_datetime_within_week()
            duration_minutes = random.randint(30, 240)
            end_time = start_time + timedelta(minutes=duration_minutes)

            category = random.choice(CATEGORIES)
            create_entry(token, category, start_time, end_time)

        print(f"Seeded time entries for {user}")

    print("Creating finance entries...")
    products = [
        ("Netflix Subscription", "Entertainment"),
        ("Electric Bill", "Utilities"),
        ("Grocery Run", "Groceries"),
        ("Bus Pass", "Transport"),
        ("New Shoes", "Shopping"),
        ("Doctor Visit", "Healthcare"),
        ("Movie Tickets", "Entertainment"),
        ("Internet Bill", "Utilities"),
        ("Gym Membership", "Healthcare"),
        ("Restaurant Dinner", "Entertainment"),
    ]

    for user, token in tokens.items():
        for _ in range(FINANCE_ENTRIES_PER_USER):
            product_name, category = random.choice(products)
            price = round(random.uniform(5.0, 150.0), 2)
            purchase_date = random_datetime_within_week()
            status = random.choice(["planned", "done"])

            create_finance_entry(token, product_name, category, price, purchase_date, status)

        print(f"Seeded finance entries for {user}")

    print("Done.")


if __name__ == "__main__":
    seed()
