def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_login_ok(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "Admin123!"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["usuario"]["username"] == "admin"
    assert data["usuario"]["rol"] == "admin"


def test_login_bad_password(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401


def test_login_bad_username(client):
    res = client.post("/api/auth/login", json={"username": "noexiste", "password": "Admin123!"})
    assert res.status_code == 401


def test_me(client, auth_headers):
    res = client.get("/api/auth/me", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["username"] == "admin"


def test_me_no_token(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_register_ok(client, auth_headers):
    res = client.post("/api/auth/register", headers=auth_headers, json={
        "username": "cajero1", "email": "cajero@example.com",
        "password": "Cajero123!", "nombre_completo": "Test Cajero", "rol": "cajero",
    })
    assert res.status_code == 201
    assert res.json()["rol"] == "cajero"


def test_register_duplicate_username(client, auth_headers):
    client.post("/api/auth/register", headers=auth_headers, json={
        "username": "dup", "email": "dup1@example.com",
        "password": "Pass123!", "nombre_completo": "Dup", "rol": "cajero",
    })
    res = client.post("/api/auth/register", headers=auth_headers, json={
        "username": "dup", "email": "dup2@example.com",
        "password": "Pass123!", "nombre_completo": "Dup2", "rol": "cajero",
    })
    assert res.status_code == 400


def test_register_no_auth(client):
    res = client.post("/api/auth/register", json={
        "username": "x", "email": "x@example.com",
        "password": "Pass123!", "nombre_completo": "X", "rol": "cajero",
    })
    assert res.status_code == 401
