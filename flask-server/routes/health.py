"""Liveness and token-validity probes.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""


from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

import app

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy"}), 200


@health_bp.get("/protected")
@jwt_required()
def protected():
    current_user = get_jwt_identity()

    return jsonify(message="Access granted", user=current_user), 200

