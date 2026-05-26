"""
routes/auth_routes.py  –  Authentication Blueprint (login / register / logout).

Security measures
─────────────────
  • Rate limiting   : login 10 req/min, register 5 req/hour (via Flask-Limiter)
  • CSRF protection : hidden token validated on every POST (via Flask-WTF)
  • Timing-safe login: always runs verify_password even when username not found,
                       so response time cannot reveal whether an account exists
  • Username rules  : 3–30 chars, letters / digits / _ / - only
  • Password max    : 200 chars (prevents DoS via hash cost on huge inputs)

Blueprint name : "auth"
URL prefix     : (none — routes mount at /, /login, /register, /logout)
"""

import re
import sqlite3

from flask import Blueprint, redirect, render_template, request, session, url_for

from database import get_connection
from extensions import limiter
from models.auth import hash_password, verify_password

auth_bp = Blueprint("auth", __name__)

# ── Constants ─────────────────────────────────────────────────────────────────

USERNAME_RE  = re.compile(r'^[A-Za-z0-9_-]+$')
USERNAME_MIN = 3
USERNAME_MAX = 30
PASSWORD_MIN = 6
PASSWORD_MAX = 200

# Pre-computed dummy hash — used in the timing-safe login path so that a
# missing username takes the same CPU time as a wrong password.
_DUMMY_HASH = hash_password("__dummy_that_never_matches__")


# ── Login ─────────────────────────────────────────────────────────────────────

@auth_bp.route("/login", methods=["GET", "POST"])
@limiter.limit("10 per minute", error_message="Too many login attempts — please wait a minute.")
def login():
    if "user_id" in session:
        return redirect(url_for("session.index"))

    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if username and password:
            conn = get_connection()
            cur  = conn.cursor()
            cur.execute(
                "SELECT id, password_hash FROM users WHERE username = ?",
                (username,),
            )
            row = cur.fetchone()
            conn.close()

            if row:
                # Normal path — verify the stored hash
                valid = verify_password(row["password_hash"], password)
            else:
                # Timing-safe path — run the same hash work so response time
                # does NOT reveal whether the username exists
                verify_password(_DUMMY_HASH, password)
                valid = False

            if valid:
                session.permanent   = True
                session["user_id"]  = row["id"]
                session["username"] = username
                return redirect(url_for("session.index"))

        error = "Invalid username or password."

    return render_template("login.html", error=error, active_tab="login")


# ── Register ──────────────────────────────────────────────────────────────────

@auth_bp.route("/register", methods=["GET", "POST"])
@limiter.limit("5 per hour", error_message="Too many registration attempts — please try again later.")
def register():
    if "user_id" in session:
        return redirect(url_for("session.index"))

    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm  = request.form.get("confirm",  "")

        # ── Validation ────────────────────────────────────────────────────────
        if not username:
            error = "Username is required."
        elif len(username) < USERNAME_MIN:
            error = f"Username must be at least {USERNAME_MIN} characters."
        elif len(username) > USERNAME_MAX:
            error = f"Username must be {USERNAME_MAX} characters or fewer."
        elif not USERNAME_RE.match(username):
            error = "Username may only contain letters, numbers, _ and -"
        elif not password:
            error = "Password is required."
        elif len(password) < PASSWORD_MIN:
            error = f"Password must be at least {PASSWORD_MIN} characters."
        elif len(password) > PASSWORD_MAX:
            error = f"Password must be {PASSWORD_MAX} characters or fewer."
        elif password != confirm:
            error = "Passwords do not match."
        else:
            conn = None
            try:
                conn = get_connection()
                cur  = conn.cursor()
                cur.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, hash_password(password)),
                )
                user_id = cur.lastrowid
                conn.commit()
                session.permanent   = True
                session["user_id"]  = user_id
                session["username"] = username
                return redirect(url_for("session.index"))
            except sqlite3.IntegrityError:
                # Vague message — don't confirm whether the username exists
                error = "Could not create account — please try a different username."
            finally:
                if conn:
                    conn.close()

    return render_template("login.html", error=error, active_tab="register")


# ── Logout ────────────────────────────────────────────────────────────────────

@auth_bp.route("/logout", methods=["POST"])
def logout():
    """POST-only logout prevents CSRF-logout attacks via crafted links."""
    session.clear()
    return redirect(url_for("auth.login"))
