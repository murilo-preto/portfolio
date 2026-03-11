import os
import requests
import random
from datetime import datetime, timedelta, timezone

API_HOST = os.getenv("API_HOST", "localhost")
API_PORT = os.getenv("PORT", "3000")
BASE_URL = f"http://{API_HOST}:{API_PORT}"

DEFAULT_PASSWORD = os.getenv("SEED_USER_PASSWORD", "password123")

USERS = ["alice", "bob", "charlie"]
CATEGORIES = ["Work", "Study", "Exercise", "Reading"]
FINANCE_CATEGORIES = ["Groceries", "Utilities", "Entertainment", "Shopping", "Transport", "Healthcare"]

ENTRIES_PER_USER = 10
FINANCE_ENTRIES_PER_USER = 8
DAYS_SPAN = 7


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
    response = requests.post(
        f"{BASE_URL}/register",
        json={"username": username, "password": DEFAULT_PASSWORD},
    )
    print(f"Register {username}: {response.status_code}")


def create_category(name):
    response = requests.post(
        f"{BASE_URL}/category",
        json={"name": name},
    )
    print(f"Category {name}: {response.status_code}")


def create_finance_category(name):
    response = requests.post(
        f"{BASE_URL}/finance/category",
        json={"name": name},
    )
    print(f"Finance category {name}: {response.status_code}")


def create_entry(username, category, start_time, end_time):
    response = requests.post(
        f"{BASE_URL}/entry/create",
        json={
            "username": username,
            "category": category,
            "start_time": to_iso_utc(start_time),
            "end_time": to_iso_utc(end_time),
        },
    )

    if response.status_code != 201:
        print("Entry error:", response.status_code, response.text)


def get_auth_token(username):
    """Login and get access token for a user."""
    response = requests.post(
        f"{BASE_URL}/login",
        json={"username": username, "password": DEFAULT_PASSWORD},
    )
    if response.status_code == 200:
        return response.json().get("access_token")
    return None


def create_finance_entry(token, product_name, category, price, purchase_date, status="planned"):
    response = requests.post(
        f"{BASE_URL}/finance/create",
        json={
            "product_name": product_name,
            "category": category,
            "price": price,
            "purchase_date": to_iso_utc(purchase_date),
            "status": status,
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    if response.status_code != 201:
        print("Finance entry error:", response.status_code, response.text)


def create_recurring_expense(token, name, category, amount, frequency, start_date, end_date=None, next_payment_date=None):
    payload = {
        "name": name,
        "category": category,
        "amount": amount,
        "frequency": frequency,
        "start_date": start_date,
    }
    if end_date:
        payload["end_date"] = end_date
    if next_payment_date:
        payload["next_payment_date"] = next_payment_date

    response = requests.post(
        f"{BASE_URL}/recurring-expenses/create",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )

    if response.status_code != 201:
        print("Recurring expense error:", response.status_code, response.text)


def seed():
    print(f"Seeding API at {BASE_URL}")

    print("Creating categories...")
    for category in CATEGORIES:
        create_category(category)

    print("Creating finance categories...")
    for category in FINANCE_CATEGORIES:
        create_finance_category(category)

    print("Creating users...")
    for user in USERS:
        register_user(user)

    print("Creating time entries...")
    for user in USERS:
        for _ in range(ENTRIES_PER_USER):
            start_time = random_datetime_within_week()
            duration_minutes = random.randint(30, 240)
            end_time = start_time + timedelta(minutes=duration_minutes)

            category = random.choice(CATEGORIES)
            create_entry(user, category, start_time, end_time)

        print(f"Seeded time entries for {user}")

    print("Creating finance entries...")
    for user in USERS:
        token = get_auth_token(user)
        if not token:
            print(f"Failed to get token for {user}, skipping finance entries")
            continue

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

        for _ in range(FINANCE_ENTRIES_PER_USER):
            product_name, category = random.choice(products)
            price = round(random.uniform(5.0, 150.0), 2)
            purchase_date = random_datetime_within_week()
            status = random.choice(["planned", "done"])

            create_finance_entry(token, product_name, category, price, purchase_date, status)

        print(f"Seeded finance entries for {user}")

    print("Creating recurring expenses...")
    for user in USERS:
        token = get_auth_token(user)
        if not token:
            print(f"Failed to get token for {user}, skipping recurring expenses")
            continue

        recurring_expenses = [
            ("Netflix Subscription", "Entertainment", 15.99, "monthly"),
            ("Internet Bill", "Utilities", 79.99, "monthly"),
            ("Gym Membership", "Healthcare", 49.99, "monthly"),
            ("Electric Bill", "Utilities", 120.00, "monthly"),
            ("Spotify Premium", "Entertainment", 9.99, "monthly"),
            ("Bus Pass", "Transport", 50.00, "monthly"),
            ("Amazon Prime", "Shopping", 139.00, "yearly"),
            ("Car Insurance", "Transport", 450.00, "quarterly"),
        ]

        for name, category, amount, frequency in recurring_expenses:
            start_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            next_payment = datetime.now(timezone.utc) + timedelta(days=7)
            create_recurring_expense(
                token, name, category, amount, frequency, start_date,
                next_payment_date=next_payment.strftime("%Y-%m-%d")
            )

        print(f"Seeded recurring expenses for {user}")

    print("Done.")


if __name__ == "__main__":
    seed()
