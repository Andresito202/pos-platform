def _crear_categoria(client, auth_headers):
    res = client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Pollo"})
    return res.json()["id"]


def test_crear_producto(client, auth_headers):
    cat_id = _crear_categoria(client, auth_headers)
    res = client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "P001", "nombre": "Pechuga", "categoria_id": cat_id,
        "precio_compra": 12000, "precio_venta": 16000, "es_perecedero": True,
    })
    assert res.status_code == 201
    assert res.json()["codigo"] == "P001"
    assert res.json()["es_perecedero"] is True


def test_listar_productos(client, auth_headers):
    cat_id = _crear_categoria(client, auth_headers)
    client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "P001", "nombre": "Pechuga", "categoria_id": cat_id,
        "precio_compra": 12000, "precio_venta": 16000,
    })
    res = client.get("/api/productos/", headers=auth_headers)
    assert res.status_code == 200
    assert len(res.json()) >= 1


def test_buscar_producto(client, auth_headers):
    cat_id = _crear_categoria(client, auth_headers)
    client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "P001", "nombre": "Pechuga fresca", "categoria_id": cat_id,
        "precio_compra": 12000, "precio_venta": 16000,
    })
    res = client.get("/api/productos/?buscar=pechuga", headers=auth_headers)
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_codigo_duplicado(client, auth_headers):
    cat_id = _crear_categoria(client, auth_headers)
    client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "DUP", "nombre": "Prod1", "categoria_id": cat_id,
        "precio_compra": 1000, "precio_venta": 2000,
    })
    res = client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "DUP", "nombre": "Prod2", "categoria_id": cat_id,
        "precio_compra": 1000, "precio_venta": 2000,
    })
    assert res.status_code == 400


def test_categoria_invalida(client, auth_headers):
    res = client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "X", "nombre": "X", "categoria_id": 999,
        "precio_compra": 1000, "precio_venta": 2000,
    })
    assert res.status_code == 400


def test_precio_negativo(client, auth_headers):
    cat_id = _crear_categoria(client, auth_headers)
    res = client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "NEG", "nombre": "Negativo", "categoria_id": cat_id,
        "precio_compra": -100, "precio_venta": 2000,
    })
    assert res.status_code == 422
