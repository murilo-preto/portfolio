"""Resolving the caller's row id from the identity in their token.

The JWT carries a username, not a user id, so every authenticated handler that
touches a user-scoped table has to translate one into the other first. That
translation was written out longhand in fifteen places; scoping the category and
tag tables per user added several more call sites, so it lives here now.

The cursor is passed in rather than opened here, for two reasons. The caller is
usually already inside a `get_cursor()` block and the lookup belongs in the same
transaction as the work it authorizes — resolving the id in one transaction and
writing in another leaves a window where the user could be deleted in between.
And taking a cursor means this module does not import back into app.py, the same
arrangement migrations.py and category_admin.py both use.
"""


def resolve_user_id(cursor, username):
    """The caller's id, or None when the token names a user that is gone.

    A valid token outliving its user is the case worth being careful about:
    tokens stay good for TOKEN_DURATION_HOURS, so an account deleted mid-session
    still presents one. Returning None lets the caller answer 404 rather than
    carrying a null id into a query.
    """
    cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
    row = cursor.fetchone()
    return row["id"] if row else None
