from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.inventario import MovimientoInventario, TipoMovimiento
from app.models.lote import Lote
from app.models.producto import Producto
from app.models.usuario import RolEnum, Usuario
from app.schemas.inventario import AjusteInventarioIn, MovimientoInventarioOut, StockProducto
from app.schemas.lote import AlertaVencimiento, LoteOut

router = APIRouter(prefix="/inventario", tags=["Inventario"])


@router.get("/stock", response_model=list[StockProducto])
def consultar_stock(
    solo_bajo_stock: bool = Query(False, description="Solo productos con stock bajo"),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    productos = db.query(Producto).filter(Producto.activo.is_(True)).all()
    resultado = []
    for prod in productos:
        stock_total = (
            db.query(func.coalesce(func.sum(Lote.cantidad_disponible), 0))
            .filter(Lote.producto_id == prod.id, Lote.agotado.is_(False))
            .scalar()
        )
        alerta = stock_total <= prod.stock_minimo
        if solo_bajo_stock and not alerta:
            continue
        resultado.append(
            StockProducto(
                producto_id=prod.id,
                producto_nombre=prod.nombre,
                producto_codigo=prod.codigo,
                stock_total=Decimal(str(stock_total)),
                stock_minimo=prod.stock_minimo,
                alerta_stock_bajo=alerta,
            )
        )
    return resultado


@router.get("/lotes", response_model=list[LoteOut])
def listar_lotes(
    producto_id: int | None = Query(None),
    solo_disponibles: bool = Query(True),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(Lote)
    if producto_id is not None:
        query = query.filter(Lote.producto_id == producto_id)
    if solo_disponibles:
        query = query.filter(Lote.agotado.is_(False))
    return query.order_by(Lote.fecha_ingreso.asc()).all()


@router.get("/alertas-vencimiento", response_model=list[AlertaVencimiento])
def alertas_vencimiento(
    dias: int = Query(7, description="Dias para considerar proximo a vencer"),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    fecha_limite = date.today() + timedelta(days=dias)
    lotes = (
        db.query(Lote)
        .filter(
            Lote.agotado.is_(False),
            Lote.fecha_vencimiento.isnot(None),
            Lote.fecha_vencimiento <= fecha_limite,
        )
        .order_by(Lote.fecha_vencimiento.asc())
        .all()
    )
    alertas = []
    for lote in lotes:
        producto = db.query(Producto).filter(Producto.id == lote.producto_id).first()
        dias_rest = (lote.fecha_vencimiento - date.today()).days
        alertas.append(
            AlertaVencimiento(
                lote_id=lote.id,
                codigo_lote=lote.codigo_lote,
                producto_id=lote.producto_id,
                producto_nombre=producto.nombre if producto else "Desconocido",
                cantidad_disponible=lote.cantidad_disponible,
                fecha_vencimiento=lote.fecha_vencimiento,
                dias_restantes=dias_rest,
            )
        )
    return alertas


@router.get("/movimientos", response_model=list[MovimientoInventarioOut])
def listar_movimientos(
    producto_id: int | None = Query(None),
    tipo: TipoMovimiento | None = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(MovimientoInventario)
    if producto_id is not None:
        query = query.filter(MovimientoInventario.producto_id == producto_id)
    if tipo is not None:
        query = query.filter(MovimientoInventario.tipo == tipo)
    return query.order_by(MovimientoInventario.created_at.desc()).limit(limit).all()


@router.post("/ajuste", response_model=MovimientoInventarioOut)
def ajuste_inventario(
    data: AjusteInventarioIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_roles(RolEnum.admin, RolEnum.supervisor, RolEnum.bodeguero)
    ),
):
    producto = db.query(Producto).filter(Producto.id == data.producto_id, Producto.activo.is_(True)).first()
    if not producto:
        raise HTTPException(status_code=400, detail="Producto no existe o esta inactivo")

    if data.lote_id:
        lote = db.query(Lote).filter(Lote.id == data.lote_id, Lote.producto_id == data.producto_id).first()
        if not lote:
            raise HTTPException(status_code=400, detail="Lote no encontrado para este producto")
        if data.tipo == TipoMovimiento.ajuste_positivo:
            lote.cantidad_disponible += data.cantidad
            if lote.agotado:
                lote.agotado = False
        else:
            if lote.cantidad_disponible < data.cantidad:
                raise HTTPException(status_code=400, detail="Cantidad de ajuste supera el disponible en el lote")
            lote.cantidad_disponible -= data.cantidad
            if lote.cantidad_disponible == 0:
                lote.agotado = True

    mov = MovimientoInventario(
        producto_id=data.producto_id,
        lote_id=data.lote_id,
        tipo=data.tipo,
        cantidad=data.cantidad,
        usuario_id=current_user.id,
        observaciones=data.observaciones,
        referencia_tipo="ajuste_manual",
    )
    db.add(mov)
    db.commit()
    db.refresh(mov)
    return mov
