def test_crear_categoria(client, auth_headers):
    res = client.post("/api/categorias/", headers=auth_headers, json={
        "nombre": "Pollo entero", "descripcion": "Pollos frescos",
    })
    assert res.status_code == 201
    assert res.json()["nombre"] == "Pollo entero"
    assert res.json()["activa"] is True


def test_listar_categorias(client, auth_headers):
    client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Cat1"})
    client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Cat2"})
    res = client.get("/api/categorias/", headers=auth_headers)
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_obtener_categoria(client, auth_headers):
    res = client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Test"})
    cat_id = res.json()["id"]
    res = client.get(f"/api/categorias/{cat_id}", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["nombre"] == "Test"


def test_actualizar_categoria(client, auth_headers):
    res = client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Viejo"})
    cat_id = res.json()["id"]
    res = client.put(f"/api/categorias/{cat_id}", headers=auth_headers, json={"nombre": "Nuevo"})
    assert res.status_code == 200
    assert res.json()["nombre"] == "Nuevo"


def test_desactivar_categoria(client, auth_headers):
    res = client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Borrar"})
    cat_id = res.json()["id"]
    res = client.delete(f"/api/categorias/{cat_id}", headers=auth_headers)
    assert res.status_code == 204


def test_nombre_duplicado(client, auth_headers):
    client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Unica"})
    res = client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Unica"})
    assert res.status_code == 400


def test_categoria_no_existe(client, auth_headers):
    res = client.get("/api/categorias/999", headers=auth_headers)
    assert res.status_code == 404
