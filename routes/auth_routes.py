"""
routes/auth_routes.py  –  Authentication Blueprint (login / register / logout).

Blueprint name : "auth"
URL prefix     : (none — routes mount at /, /login, /register, /logout)
"""

import sqlite3

from flask import Blueprint, redirect, render_template, request, session, url_for

from database import get_connection
from models.auth import hash_password, verify_password

auth_bp = Blueprint("auth", __name__)


# ── Login ─────────────────────────────────────────────────────────────────────

@auth_bp.route("/login", methods=["GET", "POST"])
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

            if row and verify_password(row["password_hash"], password):
                session.permanent   = True
                session["user_id"]  = row["id"]
                session["username"] = username
                return redirect(url_for("session.index"))

        error = "Invalid username or password."

    return render_template("login.html", error=error, active_tab="login")


# ── Register ──────────────────────────────────────────────────────────────────

@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if "user_id" in session:
        return redirect(url_for("session.index"))

    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm  = request.form.get("confirm",  "")

        if not username:
            error = "Username is required."
        elif len(username) < 3:
            error = "Username must be at least 3 characters."
        elif not password:
            error = "Password is required."
        elif len(password) < 6:
            error = "Password must be at least 6 characters."
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
                error = "That username is already taken — please choose another."
            finally:
                if conn:
                    conn.close()

    return render_template("login.html", error=error, active_tab="register")


# ── Logout ────────────────────────────────────────────────────────────────────

@auth_bp.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
