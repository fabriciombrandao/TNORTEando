import hashlib, hmac
from datetime import datetime, timedelta, timezone
from typing import Optional, Union
from jose import JWTError, jwt
from app.core.config import settings

def _h(p): return "pbkdf2:" + hashlib.pbkdf2_hmac("sha256",p.encode(),b"salt",100000).hex()
def verify_password(plain, hashed):
    if hashed.startswith("pbkdf2:"): return hmac.compare_digest(_h(plain), hashed)
    try:
        from passlib.context import CryptContext
        return CryptContext(schemes=["bcrypt"],deprecated="auto").verify(plain,hashed)
    except: return False
def get_password_hash(p): return _h(p)
def create_access_token(subject, expires_delta=None):
    expire=datetime.now(timezone.utc)+(expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    return jwt.encode({"sub":str(subject),"exp":expire,"type":"access"},settings.SECRET_KEY,algorithm=settings.ALGORITHM)
def create_refresh_token(subject):
    expire=datetime.now(timezone.utc)+timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub":str(subject),"exp":expire,"type":"refresh"},settings.SECRET_KEY,algorithm=settings.ALGORITHM)
def decode_token(token):
    try: return jwt.decode(token,settings.SECRET_KEY,algorithms=[settings.ALGORITHM])
    except JWTError: return None
