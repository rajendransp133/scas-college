"""Password hashing (bcrypt) and JWT issue/verify."""

from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from config import settings


def _pw_bytes(password: str) -> bytes:
    # bcrypt only uses the first 72 bytes; truncate to stay within the hard limit.
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_pw_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_pw_bytes(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, epoch: int = 0) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    # `epoch` is the account's token_epoch at issue time; get_current_user
    # rejects the token once the account's value moves past it.
    payload = {"sub": subject, "epoch": epoch, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[tuple[str, int]]:
    """Returns `(subject, epoch)` or None. Legacy tokens with no `epoch` claim
    read as epoch 0, which matches a never-rotated account's default."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        sub = payload.get("sub")
        if not sub:
            return None
        return sub, int(payload.get("epoch", 0))
    except JWTError:
        return None
