from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

_url = settings.db_url
_connect_args = {}
_kwargs = {}
if _url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}
else:
    _kwargs = {"pool_pre_ping": True}

engine = create_engine(_url, connect_args=_connect_args, **_kwargs)

# Habilitar foreign keys en SQLite
if _url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
