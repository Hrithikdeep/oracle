from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from config import JWT_SECRET
from database import get_db
from models.user import User

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# Single demo login for this project — not multi-tenant registration. Reuses
# the same placeholder user created everywhere else in the app (see
# agents.orchestrator.SYSTEM_USER_EMAIL and api.projects.SYSTEM_USER_EMAIL).
# The password is intentionally not a secret — it's shown on the login page.
DEMO_USER_EMAIL = "system@oracle.local"
DEMO_USER_PASSWORD = "oracle-demo-2026"

# auto_error=False so a missing Authorization header reaches get_current_user
# as credentials=None instead of HTTPBearer's own default behavior, which
# raises 403 Forbidden — the wrong status for "not authenticated".
_bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = lambda detail: HTTPException(  # noqa: E731
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise unauthorized("not authenticated")

    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise unauthorized("token expired")
    except jwt.InvalidTokenError:
        raise unauthorized("invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise unauthorized("invalid token payload")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise unauthorized("user no longer exists")

    return user
