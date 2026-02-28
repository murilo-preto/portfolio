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

ENTRIES_PER_USER = 10
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


def create_entry(username, category, start_time, end_time):
    response = requests.post(
        f"{BASE_URL}/create/entry",
        json={
            "username": username,
            "category": category,
            "start_time": to_iso_utc(start_time),
            "end_time": to_iso_utc(end_time),
        },
    )

    if response.status_code != 201:
        print("Entry error:", response.status_code, response.text)


def seed():
    print(f"Seeding API at {BASE_URL}")

    print("Creating categories...")
    for category in CATEGORIES:
        create_category(category)

    print("Creating users...")
    for user in USERS:
        register_user(user)

    print("Creating entries...")
    for user in USERS:
        for _ in range(ENTRIES_PER_USER):
            start_time = random_datetime_within_week()
            duration_minutes = random.randint(30, 240)
            end_time = start_time + timedelta(minutes=duration_minutes)

            category = random.choice(CATEGORIES)
            create_entry(user, category, start_time, end_time)

        print(f"Seeded entries for {user}")

    print("Done.")


if __name__ == "__main__":
    seed()
