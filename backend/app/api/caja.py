from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.caja import Caja, EstadoCaja, MovimientoCaja, TipoMovimientoCaja
from app.models.usuario import RolEnum, Usuario
from app.schemas.caja import CajaAbrirIn, CajaCerrarIn, CajaOut, MovimientoCajaIn, MovimientoCajaOut

router = APIRouter(prefix="/caja", tags=["Caja"])


@router.get("/actual", response_model=CajaOut | None)
def caja_actual(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    caja = (
        db.query(Caja)
        .filter(Caja.usuario_id == current_user.id, Caja.estado == EstadoCaja.abierta)
        .first()
    )
    return caja


@router.post("/abrir", response_model=CajaOut, status_code=status.HTTP_201_CREATED)
def abrir_caja(
    data: CajaAbrirIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_roles(RolEnum.admin, RolEnum.cajero, RolEnum.supervisor)
    ),
):
    caja_existente = (
        db.query(Caja)
        .filter(Caja.usuario_id == current_user.id, Caja.estado == EstadoCaja.abierta)
        .first()
    )
    if caja_existente:
        raise HTTPException(status_code=400, detail="Ya tienes una caja abierta")

    caja = Caja(
        usuario_id=current_user.id,
        monto_apertura=data.monto_apertura,
    )
    db.add(caja)
    db.flush()

    mov = MovimientoCaja(
        caja_id=caja.id,
        tipo=TipoMovimientoCaja.apertura,
        monto=data.monto_apertura,
        descripcion="Apertura de caja",
        usuario_id=current_user.id,
    )
    db.add(mov)
    db.commit()
    db.refresh(caja)
    return caja


@router.post("/cerrar", response_model=CajaOut)
def cerrar_caja(
    data: CajaCerrarIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_roles(RolEnum.admin, RolEnum.cajero, RolEnum.supervisor)
    ),
):
    caja = (
        db.query(Caja)
        .filter(Caja.usuario_id == current_user.id, Caja.estado == EstadoCaja.abierta)
        .first()
    )
    if not caja:
        raise HTTPException(status_code=400, detail="No tienes una caja abierta")

    monto_esperado = caja.monto_apertura
    for mov in caja.movimientos:
        if mov.tipo in (TipoMovimientoCaja.venta, TipoMovimientoCaja.ingreso):
            monto_esperado += mov.monto
        elif mov.tipo == TipoMovimientoCaja.egreso:
            monto_esperado -= mov.monto

    caja.fecha_cierre = datetime.now(timezone.utc)
    caja.monto_cierre = data.monto_cierre
    caja.monto_esperado = monto_esperado
    caja.diferencia = data.monto_cierre - monto_esperado
    caja.estado = EstadoCaja.cerrada
    caja.observaciones = data.observaciones

    db.commit()
    db.refresh(caja)
    return caja


@router.post("/movimiento", response_model=MovimientoCajaOut)
def registrar_movimiento(
    data: MovimientoCajaIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_roles(RolEnum.admin, RolEnum.cajero, RolEnum.supervisor)
    ),
):
    caja = (
        db.query(Caja)
        .filter(Caja.usuario_id == current_user.id, Caja.estado == EstadoCaja.abierta)
        .first()
    )
    if not caja:
        raise HTTPException(status_code=400, detail="No tienes una caja abierta")

    mov = MovimientoCaja(
        caja_id=caja.id,
        tipo=data.tipo,
        monto=data.monto,
        descripcion=data.descripcion,
        usuario_id=current_user.id,
    )
    db.add(mov)
    db.commit()
    db.refresh(mov)
    return mov
