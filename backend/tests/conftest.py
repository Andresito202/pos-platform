"""
Configuracion de tests con base de datos SQLite en memoria.
No requiere PostgreSQL para ejecutar las pruebas.
"""
import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-supermercado-avicola-suite")
os.environ.setdefault("ADMIN_PASSWORD", "Admin123!")
os.environ.setdefault("CORS_ORIGINS", "http://testserver")
os.environ.setdefault("AUTO_CREATE_TABLES", "false")
os.environ.setdefault("SEED_DEMO_DATA", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import app
from app.models.usuario import RolEnum, Usuario

SQLALCHEMY_TEST_URL = "sqlite://"

engine_test = create_engine(
    SQLALCHEMY_TEST_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool,
)
TestSession = sessionmaker(bind=engine_test, autocommit=False, autoflush=False)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine_test)
    db = TestSession()
    admin = Usuario(
        username="admin", email="admin@example.com",
        hashed_password=hash_password("Admin123!"),
        nombre_completo="Admin Test", rol=RolEnum.admin,
    )
    db.add(admin)
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine_test)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_token(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "Admin123!"})
    return res.json()["access_token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
