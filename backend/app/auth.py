"""Who may sign in, and what each role may do.

    viewer  reads the dashboard, the seed lots and the farmer entries
    editor  also adds, changes and deletes seed lots, and imports and
            exports entries
    admin   also changes the form questions and manages staff accounts

Farmers never sign in: the pages a QR code opens are public.
"""

import hashlib
import secrets
import time
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import schemas
from .config import settings
from .database import get_db
from .models import AdminSession, User, utc_now

hasher = PasswordHasher()
# Checked when the username is unknown, so that reply takes as long as a
# wrong password does.
NO_USER_HASH = hasher.hash(secrets.token_hex(16))


def password_matches(password_hash: str, password: str) -> bool:
    try:
        return hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def token_key(token: str) -> str:
    """What is stored for a token: the browser holds the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()


def bearer(authorization: str) -> str:
    return authorization.removeprefix("Bearer ").strip()


def user_for_token(token: str, db: Session) -> User:
    session = db.get(AdminSession, token_key(token)) if token else None
    if session is None or session.expires_at < utc_now():
        raise HTTPException(401, "Please sign in again.")
    user = db.get(User, session.user_id)
    if user is None or not user.active:
        raise HTTPException(401, "Please sign in again.")
    return user


def current_user(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> User:
    return user_for_token(bearer(authorization), db)


def allow(*roles: str):
    def check(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Your account is not allowed to do this.")
        return user

    return check


# Used as dependencies on the routes.
signed_in = current_user
editor = allow("admin", "editor")
admin = allow("admin")


def seed_admin(db: Session) -> None:
    """Makes the first admin from ADMIN_USERNAME and ADMIN_PASSWORD, when
    there are no accounts at all."""
    if db.scalar(select(func.count(User.id))):
        return
    username = settings.admin_username.strip().lower()
    password = settings.admin_password.strip()
    if not username or not password:
        print("No accounts yet. Set ADMIN_USERNAME and ADMIN_PASSWORD to make the first admin.")
        return
    db.add(User(username=username, password_hash=hasher.hash(password), role="admin"))
    db.commit()
    print(f"Made the first admin account, {username!r}.")


router = APIRouter(prefix="/api")


@router.post("/login", response_model=schemas.Token)
def login(body: schemas.Login, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username.lower()))
    # A hash is always checked, so the reply does not reveal which was wrong.
    ok = password_matches(user.password_hash if user else NO_USER_HASH, body.password)
    if not (user and user.active and ok):
        time.sleep(0.6)  # slow down guessing
        raise HTTPException(403, "That username or password is not correct.")

    db.execute(delete(AdminSession).where(AdminSession.expires_at < utc_now()))
    token = secrets.token_hex(32)
    db.add(
        AdminSession(
            token=token_key(token),
            user_id=user.id,
            expires_at=utc_now() + timedelta(hours=settings.session_hours),
        )
    )
    db.commit()
    return {"token": token, "username": user.username, "role": user.role}


@router.post("/logout", response_model=schemas.Ok)
def logout(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    db.execute(
        delete(AdminSession).where(AdminSession.token == token_key(bearer(authorization)))
    )
    db.commit()
    return {}


# ---- Staff accounts ------------------------------------------------------


def other_admins(user: User, db: Session) -> int:
    return db.scalar(
        select(func.count(User.id)).where(
            User.role == "admin", User.active.is_(True), User.id != user.id
        )
    )


@router.get(
    "/staff", response_model=list[schemas.StaffOut], dependencies=[Depends(admin)]
)
def list_staff(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.username)).all()


@router.post("/staff", response_model=schemas.StaffOut, dependencies=[Depends(admin)])
def add_staff(body: schemas.StaffNew, db: Session = Depends(get_db)):
    user = User(
        username=body.username.lower(),
        password_hash=hasher.hash(body.password),
        role=body.role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "That username is already taken.")
    return user


@router.put(
    "/staff/{user_id}", response_model=schemas.StaffOut, dependencies=[Depends(admin)]
)
def change_staff(user_id: int, body: schemas.StaffChange, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Not found.")
    still_admin = body.role == "admin" and body.active
    if user.role == "admin" and user.active and not still_admin and not other_admins(user, db):
        raise HTTPException(400, "Keep at least one active admin.")

    changed = (user.role, user.active) != (body.role, body.active) or body.password
    user.role = body.role
    user.active = body.active
    if body.password:
        user.password_hash = hasher.hash(body.password)
    if changed:
        # Signed out everywhere, so the change applies straight away.
        db.execute(delete(AdminSession).where(AdminSession.user_id == user.id))
    db.commit()
    return user
