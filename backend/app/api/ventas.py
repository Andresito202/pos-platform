from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.caja import Caja, EstadoCaja, MovimientoCaja, TipoMovimientoCaja
from app.models.cliente import Cliente
from app.models.inventario import MovimientoInventario, TipoMovimiento
from app.models.lote import Lote
from app.models.producto import Producto
from app.models.usuario import RolEnum, Usuario
from app.models.venta import DetalleVenta, EstadoVenta, Venta
from app.schemas.venta import VentaCreate, VentaOut

router = APIRouter(prefix="/ventas", tags=["Ventas / POS"])


def _generar_numero_venta(db: Session) -> str:
    hoy = datetime.now(timezone.utc).strftime("%Y%m%d")
    count = db.query(func.count(Venta.id)).filter(Venta.numero.like(f"V-{hoy}%")).scalar()
    return f"V-{hoy}-{(count or 0) + 1:04d}"


def _descontar_fifo(
    db: Session, producto_id: int, cantidad: Decimal, usuario_id: int, venta_id: int
) -> int | None:
    """Descuenta stock usando FIFO. Retorna el lote_id del primer lote afectado."""
    lotes = (
        db.query(Lote)
        .filter(Lote.producto_id == producto_id, Lote.agotado.is_(False))
        .order_by(Lote.fecha_ingreso.asc(), Lote.id.asc())
        .all()
    )

    restante = cantidad
    primer_lote_id = None

    for lote in lotes:
        if restante <= 0:
            break
        if primer_lote_id is None:
            primer_lote_id = lote.id

        disponible = lote.cantidad_disponible
        descontar = min(disponible, restante)

        lote.cantidad_disponible -= descontar
        if lote.cantidad_disponible <= 0:
            lote.agotado = True

        mov = MovimientoInventario(
            producto_id=producto_id,
            lote_id=lote.id,
            tipo=TipoMovimiento.salida,
            cantidad=descontar,
            referencia_id=venta_id,
            referencia_tipo="venta",
            usuario_id=usuario_id,
            observaciones=f"Venta #{venta_id}, lote {lote.codigo_lote}",
        )
        db.add(mov)
        restante -= descontar

    if restante > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Stock insuficiente para producto ID {producto_id}. Faltan {restante} unidades.",
        )

    return primer_lote_id


@router.get("/", response_model=list[VentaOut])
def listar_ventas(
    estado: EstadoVenta | None = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(Venta)
    if estado is not None:
        query = query.filter(Venta.estado == estado)
    return query.order_by(Venta.fecha.desc()).limit(limit).all()


@router.get("/{venta_id}", response_model=VentaOut)
def obtener_venta(
    venta_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    venta = db.query(Venta).filter(Venta.id == venta_id).first()
    if not venta:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    return venta


@router.post("/", response_model=VentaOut, status_code=status.HTTP_201_CREATED)
def crear_venta(
    data: VentaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_roles(RolEnum.admin, RolEnum.cajero, RolEnum.supervisor)
    ),
):
    if data.cliente_id:
        if not db.query(Cliente).filter(Cliente.id == data.cliente_id).first():
            raise HTTPException(status_code=400, detail="Cliente no encontrado")

    caja_abierta = (
        db.query(Caja)
        .filter(Caja.usuario_id == current_user.id, Caja.estado == EstadoCaja.abierta)
        .first()
    )

    venta = Venta(
        numero=_generar_numero_venta(db),
        cliente_id=data.cliente_id,
        usuario_id=current_user.id,
        caja_id=caja_abierta.id if caja_abierta else None,
        metodo_pago=data.metodo_pago,
        observaciones=data.observaciones,
    )
    db.add(venta)
    db.flush()

    total = Decimal("0")

    for item in data.detalles:
        producto = db.query(Producto).filter(
            Producto.id == item.producto_id, Producto.activo.is_(True)
        ).first()
        if not producto:
            raise HTTPException(
                status_code=400, detail=f"Producto ID {item.producto_id} no existe o esta inactivo"
            )

        stock_total = (
            db.query(func.coalesce(func.sum(Lote.cantidad_disponible), 0))
            .filter(Lote.producto_id == item.producto_id, Lote.agotado.is_(False))
            .scalar()
        )
        if stock_total < item.cantidad:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuficiente para '{producto.nombre}'. Disponible: {stock_total}, solicitado: {item.cantidad}",
            )

        subtotal = item.cantidad * producto.precio_venta
        total += subtotal

        lote_id = _descontar_fifo(db, item.producto_id, item.cantidad, current_user.id, venta.id)

        detalle = DetalleVenta(
            venta_id=venta.id,
            producto_id=item.producto_id,
            lote_id=lote_id,
            cantidad=item.cantidad,
            precio_unitario=producto.precio_venta,
            subtotal=subtotal,
        )
        db.add(detalle)

    venta.subtotal = total
    venta.total = total

    if caja_abierta:
        mov_caja = MovimientoCaja(
            caja_id=caja_abierta.id,
            tipo=TipoMovimientoCaja.venta,
            monto=total,
            descripcion=f"Venta {venta.numero}",
            usuario_id=current_user.id,
        )
        db.add(mov_caja)

    db.commit()
    db.refresh(venta)
    return venta


@router.post("/{venta_id}/anular", response_model=VentaOut)
def anular_venta(
    venta_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.supervisor)),
):
    venta = db.query(Venta).filter(Venta.id == venta_id).first()
    if not venta:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    if venta.estado == EstadoVenta.anulada:
        raise HTTPException(status_code=400, detail="La venta ya esta anulada")

    for detalle in venta.detalles:
        if detalle.lote_id:
            lote = db.query(Lote).filter(Lote.id == detalle.lote_id).first()
            if lote:
                lote.cantidad_disponible += detalle.cantidad
                lote.agotado = False
        mov = MovimientoInventario(
            producto_id=detalle.producto_id,
            lote_id=detalle.lote_id,
            tipo=TipoMovimiento.devolucion,
            cantidad=detalle.cantidad,
            referencia_id=venta.id,
            referencia_tipo="anulacion_venta",
            usuario_id=current_user.id,
            observaciones=f"Reversa por anulacion de venta {venta.numero}",
        )
        db.add(mov)

    venta.estado = EstadoVenta.anulada
    db.commit()
    db.refresh(venta)
    return venta
