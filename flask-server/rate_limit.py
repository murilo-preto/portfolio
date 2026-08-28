"""Rate-limit keying.

Flask-Limiter's stock `get_remote_address` keys on `request.remote_addr`, which
is correct only when the client talks to Flask directly. Here it does not: every
browser request arrives from the single Next.js container, so `remote_addr` is
the same value for the entire user base and every limit is really one global
bucket. A handful of people using the app normally can exhaust a cap meant to
stop one abuser.

Three things replace it.

**Identity first.** An authenticated request carries a JWT naming exactly who is
calling, which is a better bucket than any address — it survives the proxy hop,
a change of network, and NAT. The default limits therefore key on the token
identity whenever there is one.

**A forwarded address, but only from someone entitled to send one.** For
anonymous requests there is no identity, so the client address is all there is.
Flask cannot simply trust `X-Forwarded-For`: port 3000 is published to the host,
so a direct caller could set that header themselves and mint a fresh bucket per
request, which is strictly worse than the shared bucket it replaces. The header
is honoured only alongside a shared secret that the Next.js proxy knows and an
outside caller does not.

**A throttle on wrong guesses, applied where the outcome is known.** Neither of
the above helps `/login`, which is anonymous by definition and is the endpoint
worth protecting most. It gets a per-account limit on *failed* attempts, applied
inside the view rather than as a decorator; the long comment above
`FAILED_LOGIN_LIMITS` explains why the decorator form cannot work without
handing out an account-lockout DoS.

Worth being plain about the current deployment: the browser connects straight to
the Next.js container, so there is no upstream `X-Forwarded-For` for the proxy
to relay and an anonymous caller's real address is genuinely unknowable. This
resolves correctly the day something sits in front; today it falls back to
`remote_addr`, and the anonymous buckets stay shared. The identity keying and
the failed-login throttle are what change behaviour now.
"""

import hmac
import os

from flask import request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from flask_limiter.util import get_remote_address
from limits import RateLimitItemPerHour, RateLimitItemPerMinute
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter

PROXY_SECRET_HEADER = "X-Proxy-Auth"
FORWARDED_FOR_HEADER = "X-Forwarded-For"


def _configured_proxy_secret():
    """The shared secret, or "" when forwarding is not configured.

    Read per call rather than captured at import so tests can set it with
    monkeypatch, and so a deployment that adds it later needs no code change.
    """
    return os.getenv("INTERNAL_PROXY_SECRET", "")


def request_from_trusted_proxy():
    """Whether this request may dictate its own client address."""
    secret = _configured_proxy_secret()
    if not secret:
        return False
    presented = request.headers.get(PROXY_SECRET_HEADER, "")
    # Constant-time: the comparison is against a secret, and a timing oracle
    # here would hand out the ability to forge rate-limit keys.
    return hmac.compare_digest(presented, secret)


def client_address():
    """The caller's address: forwarded when that can be trusted, else the peer."""
    if request_from_trusted_proxy():
        forwarded = request.headers.get(FORWARDED_FOR_HEADER, "")
        # X-Forwarded-For is client, proxy1, proxy2… — the original client is
        # leftmost. Everything to the right was appended by a hop and would key
        # the whole app together again.
        original = forwarded.split(",")[0].strip()
        if original:
            return original
    return get_remote_address()


def current_identity():
    """The JWT identity on this request, or None if there isn't a usable one."""
    try:
        verify_jwt_in_request(optional=True)
    except Exception:
        # An expired or malformed token is not an identity. It is also not this
        # function's business to reject it — the route's own @jwt_required()
        # will, with the right status. Here it just means "key by address".
        return None
    return get_jwt_identity()


def limiter_key():
    """Default key: the authenticated user, falling back to the address.

    The prefixes keep the two namespaces from colliding — without them a user
    named after an IP address would share a bucket with that address.
    """
    identity = current_identity()
    if identity:
        return f"user:{identity}"
    return f"ip:{client_address()}"


def address_key():
    """Key strictly by address, for endpoints where identity is not meaningful.

    `/register` is the case: the caller has no token yet, and keying on the
    username they submitted would let an attacker mint a new bucket per attempt
    simply by asking for a different name.
    """
    return f"ip:{client_address()}"


# ─── Failed-login throttling ──────────────────────────────────────────────────
#
# Guessing runs target one account, so the account is the right thing to
# throttle. The obvious way to express that — a per-username `@limiter.limit`
# with `deduct_when` charging only 401s — does not work, and fails in the
# direction that matters. `deduct_when` decides whether a request is *charged*;
# the *check* still runs before the view either way. Once ten wrong guesses have
# emptied a victim's bucket, their own correct password is refused with a 429
# before Flask ever compares it. That is an account-lockout DoS: anyone able to
# send ten requests can deny any user their own account, indefinitely, by
# repeating it. Keying on the address avoids the lockout only by going back to
# one bucket for the entire user base, which is the original defect.
#
# So the throttle is applied inside the view instead, where the outcome is
# known: a correct password is answered before the block is consulted, and only
# a wrong one can be refused. Guessing one account gets throttled; the owner is
# never locked out of it.
#
# `/login` keeps a separate address-keyed volume cap as a decorator. Every
# attempt costs a bcrypt comparison whatever its outcome, and that cost has to
# be bounded by something that does not depend on knowing the outcome first.
#
# Storage is per-process, like the extension's own `memory://` — with several
# gunicorn workers each holds its own counts, so the effective limit is the
# stated one times the worker count. Both mechanisms have always had this shape;
# it is written down here rather than left to be discovered.

FAILED_LOGIN_LIMITS = (RateLimitItemPerMinute(10), RateLimitItemPerHour(30))

_failed_login_storage = MemoryStorage()
_failed_login_limiter = FixedWindowRateLimiter(_failed_login_storage)


def login_key():
    """The bucket a login attempt is counted against: the account it names."""
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    if isinstance(username, str) and username.strip():
        # Case-folded so "Alice" and "alice" cannot be used as two budgets for
        # guessing at what may well be the same account.
        return f"login:{username.strip().casefold()}"
    # A malformed body never reaches the password check; bucket it by address so
    # it cannot be used to hammer the endpoint for free.
    return f"login-malformed:{client_address()}"


def _throttling_enabled():
    """Honour RATELIMIT_ENABLED here too.

    This throttle is ours rather than the extension's, so nothing switches it
    off implicitly. It has to read the same flag, or "rate limiting is off"
    would be true of every limit except the one most likely to interfere with a
    test fixture or a seeding script hammering /login.

    Read per call, like the proxy secret, so a test can toggle it in-process.
    """
    return os.getenv("RATELIMIT_ENABLED", "true").lower() != "false"


def too_many_failed_logins(key):
    """Whether this account has already spent its budget of wrong guesses.

    Only ever consulted after a password has been found incorrect — see the
    note above on why checking it earlier would lock account owners out.
    """
    if not _throttling_enabled():
        return False
    return not all(
        _failed_login_limiter.test(limit, key) for limit in FAILED_LOGIN_LIMITS
    )


def record_failed_login(key):
    """Charge one wrong guess against the account."""
    if not _throttling_enabled():
        return
    for limit in FAILED_LOGIN_LIMITS:
        _failed_login_limiter.hit(limit, key)


def reset_failed_logins():
    """Drop all recorded failures. For tests; nothing in the app calls it."""
    _failed_login_storage.reset()
