from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.inventario import MovimientoInventario, TipoMovimiento
from app.models.lote import Lote
from app.models.merma import Merma, MotivoMerma
from app.models.producto import Producto
from app.models.usuario import RolEnum, Usuario
from app.schemas.merma import MermaCreate, MermaOut

router = APIRouter(prefix="/mermas", tags=["Mermas"])


@router.get("/", response_model=list[MermaOut])
def listar_mermas(
    producto_id: int | None = Query(None),
    motivo: MotivoMerma | None = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(Merma)
    if producto_id is not None:
        query = query.filter(Merma.producto_id == producto_id)
    if motivo is not None:
        query = query.filter(Merma.motivo == motivo)
    return query.order_by(Merma.created_at.desc()).limit(limit).all()


@router.post("/", response_model=MermaOut, status_code=status.HTTP_201_CREATED)
def registrar_merma(
    data: MermaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(
        require_roles(RolEnum.admin, RolEnum.supervisor, RolEnum.bodeguero)
    ),
):
    producto = db.query(Producto).filter(Producto.id == data.producto_id).first()
    if not producto:
        raise HTTPException(status_code=400, detail="Producto no encontrado")

    if data.lote_id:
        lote = db.query(Lote).filter(
            Lote.id == data.lote_id, Lote.producto_id == data.producto_id
        ).first()
        if not lote:
            raise HTTPException(status_code=400, detail="Lote no encontrado para este producto")
        if lote.cantidad_disponible < data.cantidad:
            raise HTTPException(
                status_code=400,
                detail=f"La cantidad de merma ({data.cantidad}) supera lo disponible en el lote ({lote.cantidad_disponible})",
            )
        lote.cantidad_disponible -= data.cantidad
        if lote.cantidad_disponible <= 0:
            lote.agotado = True

    merma = Merma(
        producto_id=data.producto_id,
        lote_id=data.lote_id,
        cantidad=data.cantidad,
        motivo=data.motivo,
        descripcion=data.descripcion,
        usuario_id=current_user.id,
    )
    db.add(merma)

    mov = MovimientoInventario(
        producto_id=data.producto_id,
        lote_id=data.lote_id,
        tipo=TipoMovimiento.merma,
        cantidad=data.cantidad,
        referencia_id=merma.id,
        referencia_tipo="merma",
        usuario_id=current_user.id,
        observaciones=f"Merma por {data.motivo.value}: {data.descripcion or 'Sin detalle'}",
    )
    db.add(mov)
    db.commit()
    db.refresh(merma)
    return merma
