import requests
import random
from datetime import datetime, timedelta

BASE_URL = "http://localhost:5000"

USERS = ["alice", "bob", "charlie"]
PASSWORD = "password123"

CATEGORIES = ["Work", "Study", "Exercise", "Reading"]

ENTRIES_PER_USER = 10
DAYS_SPAN = 7


def register_user(username):
    response = requests.post(
        f"{BASE_URL}/register",
        json={"username": username, "password": PASSWORD},
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
        f"{BASE_URL}/entry",
        json={
            "username": username,
            "category": category,
            "start_time": start_time.strftime("%Y-%m-%d %H:%M:%S"),
            "end_time": end_time.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    if response.status_code != 201:
        print("Entry error:", response.status_code, response.text)


def random_datetime_within_week():
    now = datetime.now()
    start_window = now - timedelta(days=DAYS_SPAN)

    random_seconds = random.randint(0, DAYS_SPAN * 24 * 3600)
    return start_window + timedelta(seconds=random_seconds)


def seed():
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
