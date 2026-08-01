from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.proveedor import Proveedor
from app.models.usuario import Usuario
from app.schemas.proveedor import ProveedorCreate, ProveedorOut, ProveedorUpdate

router = APIRouter(prefix="/proveedores", tags=["Proveedores"])


@router.get("/", response_model=list[ProveedorOut])
def listar_proveedores(
    activo: bool | None = Query(None),
    buscar: str | None = Query(None, description="Buscar por nombre o NIT"),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(Proveedor)
    if activo is not None:
        query = query.filter(Proveedor.activo == activo)
    if buscar:
        filtro = f"%{buscar}%"
        query = query.filter(Proveedor.nombre.ilike(filtro) | Proveedor.nit.ilike(filtro))
    return query.order_by(Proveedor.nombre).all()


@router.get("/{proveedor_id}", response_model=ProveedorOut)
def obtener_proveedor(
    proveedor_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    prov = db.query(Proveedor).filter(Proveedor.id == proveedor_id).first()
    if not prov:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return prov


@router.post("/", response_model=ProveedorOut, status_code=status.HTTP_201_CREATED)
def crear_proveedor(
    data: ProveedorCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    if db.query(Proveedor).filter(Proveedor.nit == data.nit).first():
        raise HTTPException(status_code=400, detail="Ya existe un proveedor con ese NIT")
    prov = Proveedor(**data.model_dump())
    db.add(prov)
    db.commit()
    db.refresh(prov)
    return prov


@router.put("/{proveedor_id}", response_model=ProveedorOut)
def actualizar_proveedor(
    proveedor_id: int,
    data: ProveedorUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    prov = db.query(Proveedor).filter(Proveedor.id == proveedor_id).first()
    if not prov:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(prov, field, value)
    db.commit()
    db.refresh(prov)
    return prov


@router.delete("/{proveedor_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_proveedor(
    proveedor_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    prov = db.query(Proveedor).filter(Proveedor.id == proveedor_id).first()
    if not prov:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    prov.activo = False
    db.commit()
