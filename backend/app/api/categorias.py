from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.categoria import Categoria
from app.models.usuario import Usuario
from app.schemas.categoria import CategoriaCreate, CategoriaOut, CategoriaUpdate

router = APIRouter(prefix="/categorias", tags=["Categorias"])


@router.get("/", response_model=list[CategoriaOut])
def listar_categorias(
    activa: bool | None = Query(None, description="Filtrar por estado activa/inactiva"),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(Categoria)
    if activa is not None:
        query = query.filter(Categoria.activa == activa)
    return query.order_by(Categoria.nombre).all()


@router.get("/{categoria_id}", response_model=CategoriaOut)
def obtener_categoria(
    categoria_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    cat = db.query(Categoria).filter(Categoria.id == categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria no encontrada")
    return cat


@router.post("/", response_model=CategoriaOut, status_code=status.HTTP_201_CREATED)
def crear_categoria(
    data: CategoriaCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    if db.query(Categoria).filter(Categoria.nombre == data.nombre).first():
        raise HTTPException(status_code=400, detail="Ya existe una categoria con ese nombre")
    cat = Categoria(nombre=data.nombre, descripcion=data.descripcion)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/{categoria_id}", response_model=CategoriaOut)
def actualizar_categoria(
    categoria_id: int,
    data: CategoriaUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    cat = db.query(Categoria).filter(Categoria.id == categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria no encontrada")
    if data.nombre is not None:
        existe = (
            db.query(Categoria)
            .filter(Categoria.nombre == data.nombre, Categoria.id != categoria_id)
            .first()
        )
        if existe:
            raise HTTPException(status_code=400, detail="Ya existe una categoria con ese nombre")
        cat.nombre = data.nombre
    if data.descripcion is not None:
        cat.descripcion = data.descripcion
    if data.activa is not None:
        cat.activa = data.activa
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_categoria(
    categoria_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    cat = db.query(Categoria).filter(Categoria.id == categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria no encontrada")
    cat.activa = False
    db.commit()
