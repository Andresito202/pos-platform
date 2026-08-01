from datetime import date, datetime, time, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_roles
from app.models.lote import Lote
from app.models.merma import Merma
from app.models.producto import Producto
from app.models.usuario import RolEnum, Usuario
from app.models.venta import DetalleVenta, EstadoVenta, Venta

router = APIRouter(prefix="/reportes", tags=["Reportes"])


@router.get("/ventas-diarias")
def reporte_ventas_diarias(
    fecha: date = Query(default_factory=date.today),
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.gerente, RolEnum.supervisor)),
):
    inicio = datetime.combine(fecha, time.min).replace(tzinfo=timezone.utc)
    fin = datetime.combine(fecha, time.max).replace(tzinfo=timezone.utc)

    ventas = (
        db.query(Venta)
        .filter(Venta.fecha >= inicio, Venta.fecha <= fin, Venta.estado == EstadoVenta.completada)
        .all()
    )
    total = sum(v.total for v in ventas)
    return {
        "fecha": fecha.isoformat(),
        "cantidad_ventas": len(ventas),
        "total_vendido": float(total),
        "ventas": [
            {"id": v.id, "numero": v.numero, "total": float(v.total), "metodo_pago": v.metodo_pago.value}
            for v in ventas
        ],
    }


@router.get("/productos-mas-vendidos")
def productos_mas_vendidos(
    limite: int = Query(10, le=50),
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.gerente, RolEnum.supervisor)),
):
    resultados = (
        db.query(
            DetalleVenta.producto_id,
            Producto.nombre,
            Producto.codigo,
            func.sum(DetalleVenta.cantidad).label("total_vendido"),
            func.sum(DetalleVenta.subtotal).label("total_ingresos"),
        )
        .join(Producto, DetalleVenta.producto_id == Producto.id)
        .join(Venta, DetalleVenta.venta_id == Venta.id)
        .filter(Venta.estado == EstadoVenta.completada)
        .group_by(DetalleVenta.producto_id, Producto.nombre, Producto.codigo)
        .order_by(func.sum(DetalleVenta.cantidad).desc())
        .limit(limite)
        .all()
    )
    return [
        {
            "producto_id": r.producto_id,
            "nombre": r.nombre,
            "codigo": r.codigo,
            "total_vendido": float(r.total_vendido),
            "total_ingresos": float(r.total_ingresos),
        }
        for r in resultados
    ]


@router.get("/inventario-valorizado")
def inventario_valorizado(
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.gerente, RolEnum.supervisor)),
):
    productos = db.query(Producto).filter(Producto.activo.is_(True)).all()
    items = []
    total_general = Decimal("0")

    for prod in productos:
        lotes = db.query(Lote).filter(Lote.producto_id == prod.id, Lote.agotado.is_(False)).all()
        stock = sum(l.cantidad_disponible for l in lotes)
        valor = sum(l.cantidad_disponible * l.costo_unitario for l in lotes)
        total_general += valor
        items.append({
            "producto_id": prod.id,
            "nombre": prod.nombre,
            "codigo": prod.codigo,
            "stock_disponible": float(stock),
            "valor_inventario": float(valor),
        })

    return {
        "total_valorizado": float(total_general),
        "productos": items,
    }


@router.get("/mermas-resumen")
def resumen_mermas(
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.gerente, RolEnum.supervisor)),
):
    resultados = (
        db.query(
            Merma.motivo,
            func.count(Merma.id).label("cantidad_registros"),
            func.sum(Merma.cantidad).label("total_unidades"),
        )
        .group_by(Merma.motivo)
        .all()
    )
    return [
        {
            "motivo": r.motivo.value,
            "cantidad_registros": r.cantidad_registros,
            "total_unidades": float(r.total_unidades) if r.total_unidades else 0,
        }
        for r in resultados
    ]
