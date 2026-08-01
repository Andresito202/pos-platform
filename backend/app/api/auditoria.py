from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_roles
from app.models.auditoria import Auditoria
from app.models.usuario import RolEnum, Usuario
from app.schemas.auditoria import AuditoriaOut

router = APIRouter(prefix="/auditoria", tags=["Auditoria"])


@router.get("/", response_model=list[AuditoriaOut])
def listar_auditoria(
    usuario_id: int | None = Query(None),
    entidad: str | None = Query(None),
    accion: str | None = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    _: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.gerente)),
):
    query = db.query(Auditoria)
    if usuario_id is not None:
        query = query.filter(Auditoria.usuario_id == usuario_id)
    if entidad is not None:
        query = query.filter(Auditoria.entidad == entidad)
    if accion is not None:
        query = query.filter(Auditoria.accion.ilike(f"%{accion}%"))
    return query.order_by(Auditoria.created_at.desc()).limit(limit).all()
