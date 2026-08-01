from datetime import date, timezone
from datetime import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.compra import Compra, DetalleCompra, EstadoCompra
from app.models.inventario import MovimientoInventario, TipoMovimiento
from app.models.lote import Lote
from app.models.producto import Producto
from app.models.proveedor import Proveedor
from app.models.usuario import RolEnum, Usuario
from app.schemas.compra import CompraCreate, CompraOut

router = APIRouter(prefix="/compras", tags=["Compras"])


@router.get("/", response_model=list[CompraOut])
def listar_compras(
    estado: EstadoCompra | None = Query(None),
    proveedor_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(Compra)
    if estado is not None:
        query = query.filter(Compra.estado == estado)
    if proveedor_id is not None:
        query = query.filter(Compra.proveedor_id == proveedor_id)
    return query.order_by(Compra.fecha.desc()).all()


@router.get("/{compra_id}", response_model=CompraOut)
def obtener_compra(
    compra_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    compra = db.query(Compra).filter(Compra.id == compra_id).first()
    if not compra:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    return compra


@router.post("/", response_model=CompraOut, status_code=status.HTTP_201_CREATED)
def crear_compra(
    data: CompraCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_roles(RolEnum.admin, RolEnum.bodeguero, RolEnum.supervisor)
    ),
):
    if not db.query(Proveedor).filter(Proveedor.id == data.proveedor_id, Proveedor.activo.is_(True)).first():
        raise HTTPException(status_code=400, detail="Proveedor no existe o esta inactivo")

    compra = Compra(
        proveedor_id=data.proveedor_id,
        usuario_id=current_user.id,
        observaciones=data.observaciones,
        estado=EstadoCompra.recibida,
    )
    total = 0

    for item in data.detalles:
        producto = db.query(Producto).filter(Producto.id == item.producto_id, Producto.activo.is_(True)).first()
        if not producto:
            raise HTTPException(status_code=400, detail=f"Producto ID {item.producto_id} no existe o esta inactivo")

        subtotal = item.cantidad * item.costo_unitario
        total += subtotal

        detalle = DetalleCompra(
            producto_id=item.producto_id,
            cantidad=item.cantidad,
            costo_unitario=item.costo_unitario,
            subtotal=subtotal,
        )
        compra.detalles.append(detalle)

    compra.total = total
    db.add(compra)
    db.flush()

    for item in data.detalles:
        producto = db.query(Producto).filter(Producto.id == item.producto_id).first()
        codigo_lote = f"L-{compra.id}-{item.producto_id}"
        lote = Lote(
            codigo_lote=codigo_lote,
            producto_id=item.producto_id,
            compra_id=compra.id,
            cantidad_inicial=item.cantidad,
            cantidad_disponible=item.cantidad,
            costo_unitario=item.costo_unitario,
            fecha_ingreso=date.today(),
            fecha_vencimiento=None,
        )
        db.add(lote)
        db.flush()

        mov = MovimientoInventario(
            producto_id=item.producto_id,
            lote_id=lote.id,
            tipo=TipoMovimiento.entrada,
            cantidad=item.cantidad,
            referencia_id=compra.id,
            referencia_tipo="compra",
            usuario_id=current_user.id,
            observaciones=f"Entrada por compra #{compra.id}",
        )
        db.add(mov)

        producto.precio_compra = item.costo_unitario

    db.commit()
    db.refresh(compra)
    return compra


@router.post("/{compra_id}/anular", response_model=CompraOut)
def anular_compra(
    compra_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.supervisor)),
):
    compra = db.query(Compra).filter(Compra.id == compra_id).first()
    if not compra:
        raise HTTPException(status_code=404, detail="Compra no encontrada")
    if compra.estado == EstadoCompra.anulada:
        raise HTTPException(status_code=400, detail="La compra ya esta anulada")

    for detalle in compra.detalles:
        lote = (
            db.query(Lote)
            .filter(Lote.compra_id == compra.id, Lote.producto_id == detalle.producto_id)
            .first()
        )
        if lote:
            lote.cantidad_disponible = 0
            lote.agotado = True
            mov = MovimientoInventario(
                producto_id=detalle.producto_id,
                lote_id=lote.id,
                tipo=TipoMovimiento.salida,
                cantidad=detalle.cantidad,
                referencia_id=compra.id,
                referencia_tipo="anulacion_compra",
                usuario_id=current_user.id,
                observaciones=f"Reversa por anulacion de compra #{compra.id}",
            )
            db.add(mov)

    compra.estado = EstadoCompra.anulada
    db.commit()
    db.refresh(compra)
    return compra
