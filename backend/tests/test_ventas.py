"""Tests de ventas - Valida FIFO y reglas de negocio."""


def _setup_producto_con_stock(client, auth_headers):
    """Crea categoria, producto, proveedor y compra para tener stock."""
    cat = client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Pollo"}).json()
    prod = client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "P001", "nombre": "Pechuga", "categoria_id": cat["id"],
        "precio_compra": 12000, "precio_venta": 16000, "es_perecedero": True,
    }).json()
    prov = client.post("/api/proveedores/", headers=auth_headers, json={
        "nit": "900111222-1", "nombre": "Proveedor Test",
    }).json()
    client.post("/api/compras/", headers=auth_headers, json={
        "proveedor_id": prov["id"],
        "detalles": [{"producto_id": prod["id"], "cantidad": 20, "costo_unitario": 12000}],
    })
    return prod["id"]


def test_crear_venta(client, auth_headers):
    prod_id = _setup_producto_con_stock(client, auth_headers)
    res = client.post("/api/ventas/", headers=auth_headers, json={
        "metodo_pago": "efectivo",
        "detalles": [{"producto_id": prod_id, "cantidad": 2}],
    })
    assert res.status_code == 201
    data = res.json()
    assert data["estado"] == "completada"
    assert float(data["total"]) == 32000.0


def test_venta_sin_stock(client, auth_headers):
    cat = client.post("/api/categorias/", headers=auth_headers, json={"nombre": "Test"}).json()
    prod = client.post("/api/productos/", headers=auth_headers, json={
        "codigo": "NOSTOCK", "nombre": "Sin stock", "categoria_id": cat["id"],
        "precio_compra": 1000, "precio_venta": 2000,
    }).json()
    res = client.post("/api/ventas/", headers=auth_headers, json={
        "detalles": [{"producto_id": prod["id"], "cantidad": 5}],
    })
    assert res.status_code == 400
    assert "insuficiente" in res.json()["detail"].lower()


def test_anular_venta(client, auth_headers):
    prod_id = _setup_producto_con_stock(client, auth_headers)
    venta = client.post("/api/ventas/", headers=auth_headers, json={
        "detalles": [{"producto_id": prod_id, "cantidad": 3}],
    }).json()
    res = client.post(f"/api/ventas/{venta['id']}/anular", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["estado"] == "anulada"


def test_listar_ventas(client, auth_headers):
    prod_id = _setup_producto_con_stock(client, auth_headers)
    client.post("/api/ventas/", headers=auth_headers, json={
        "detalles": [{"producto_id": prod_id, "cantidad": 1}],
    })
    res = client.get("/api/ventas/", headers=auth_headers)
    assert res.status_code == 200
    assert len(res.json()) >= 1


def test_venta_descuenta_stock(client, auth_headers):
    prod_id = _setup_producto_con_stock(client, auth_headers)
    client.post("/api/ventas/", headers=auth_headers, json={
        "detalles": [{"producto_id": prod_id, "cantidad": 5}],
    })
    stock = client.get("/api/inventario/stock", headers=auth_headers).json()
    prod_stock = next(s for s in stock if s["producto_id"] == prod_id)
    assert float(prod_stock["stock_total"]) == 15.0
