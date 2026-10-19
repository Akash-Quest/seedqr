"""Who may sign in, and what each role may do.

    viewer  reads the dashboard, the seed lots and the farmer entries
    editor  also adds, changes and deletes seed lots, and imports and
            exports entries
    admin   also changes the form questions and manages staff accounts

Farmers never sign in: the pages a QR code opens are public.
"""

import hashlib
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import limits, schemas
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
    # One question to the database for every signed-in request: the
    # sign-in, its account, and whether both are still good.
    user = (
        db.scalar(
            select(User)
            .join(AdminSession, AdminSession.user_id == User.id)
            .where(
                AdminSession.token == token_key(token),
                AdminSession.expires_at >= utc_now(),
                User.active.is_(True),
            )
        )
        if token
        else None
    )
    if user is None:
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
def login(body: schemas.Login, request: Request, db: Session = Depends(get_db)):
    username = body.username.lower()
    address = limits.client_address(request)
    pair = f"{address}\n{username}"
    # Guessing is limited per address and username together, per address,
    # and per username, so neither one address nor many can keep trying.
    counted = (
        (limits.login_by_pair, pair),
        (limits.login_by_address, address),
        (limits.login_by_username, username),
    )
    # Someone signing in from where they signed in before is held up only by
    # their own mistakes, not by strangers trying the same username.
    checked = counted[:1] if limits.signed_in_from.has(pair) else counted
    wait = max(limiter.wait(key) for limiter, key in checked)
    if wait:
        raise limits.too_many(wait)

    user = db.scalar(select(User).where(User.username == username))
    # A hash is always checked, so the reply does not reveal which was wrong.
    ok = password_matches(user.password_hash if user else NO_USER_HASH, body.password)
    if not (user and user.active and ok):
        for limiter, key in counted:
            limiter.hit(key)
        raise HTTPException(403, "That username or password is not correct.")
    limits.login_by_pair.forget(pair)
    limits.signed_in_from.add(pair)

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
    """Active admins besides this one.

    Every active admin's row stays locked until the change is saved, always
    taken in the same order. Two admins removing each other at the same
    moment then go one after the other, and the second sees the first's
    change, so they cannot both succeed and leave no admin."""
    admins = db.scalars(
        select(User.id)
        .where(User.role == "admin", User.active.is_(True))
        .order_by(User.id)
        .with_for_update()
    ).all()
    return sum(1 for admin_id in admins if admin_id != user.id)


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


@router.delete("/staff/{user_id}", response_model=schemas.Ok)
def delete_staff(user_id: int, me: User = Depends(admin), db: Session = Depends(get_db)):
    """Removes an account for good. Switching it off (above) is the gentler
    choice: that one can be undone."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Not found.")
    if user.id == me.id:
        raise HTTPException(400, "You cannot delete your own account.")
    if user.role == "admin" and user.active and not other_admins(user, db):
        raise HTTPException(400, "Keep at least one active admin.")
    db.execute(delete(AdminSession).where(AdminSession.user_id == user.id))
    db.delete(user)
    db.commit()
    return {}
