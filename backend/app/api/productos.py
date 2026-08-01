from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.categoria import Categoria
from app.models.producto import Producto
from app.models.usuario import Usuario
from app.schemas.producto import ProductoConCategoria, ProductoCreate, ProductoOut, ProductoUpdate

router = APIRouter(prefix="/productos", tags=["Productos"])


def _producto_con_categoria(producto: Producto) -> dict:
    data = ProductoOut.model_validate(producto).model_dump()
    data["categoria_nombre"] = producto.categoria.nombre if producto.categoria else None
    return data


@router.get("/", response_model=list[ProductoConCategoria])
def listar_productos(
    activo: bool | None = Query(None),
    categoria_id: int | None = Query(None),
    buscar: str | None = Query(None, description="Buscar por nombre o codigo"),
    es_perecedero: bool | None = Query(None),
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    query = db.query(Producto)
    if activo is not None:
        query = query.filter(Producto.activo == activo)
    if categoria_id is not None:
        query = query.filter(Producto.categoria_id == categoria_id)
    if es_perecedero is not None:
        query = query.filter(Producto.es_perecedero == es_perecedero)
    if buscar:
        filtro = f"%{buscar}%"
        query = query.filter(Producto.nombre.ilike(filtro) | Producto.codigo.ilike(filtro))
    productos = query.order_by(Producto.nombre).all()
    return [_producto_con_categoria(p) for p in productos]


@router.get("/{producto_id}", response_model=ProductoConCategoria)
def obtener_producto(
    producto_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    prod = db.query(Producto).filter(Producto.id == producto_id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return _producto_con_categoria(prod)


@router.post("/", response_model=ProductoOut, status_code=status.HTTP_201_CREATED)
def crear_producto(
    data: ProductoCreate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    if db.query(Producto).filter(Producto.codigo == data.codigo).first():
        raise HTTPException(status_code=400, detail="Ya existe un producto con ese codigo")
    if not db.query(Categoria).filter(Categoria.id == data.categoria_id).first():
        raise HTTPException(status_code=400, detail="La categoria indicada no existe")
    prod = Producto(**data.model_dump())
    db.add(prod)
    db.commit()
    db.refresh(prod)
    return prod


@router.put("/{producto_id}", response_model=ProductoOut)
def actualizar_producto(
    producto_id: int,
    data: ProductoUpdate,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    prod = db.query(Producto).filter(Producto.id == producto_id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    update_data = data.model_dump(exclude_unset=True)
    if "categoria_id" in update_data:
        if not db.query(Categoria).filter(Categoria.id == update_data["categoria_id"]).first():
            raise HTTPException(status_code=400, detail="La categoria indicada no existe")
    for field, value in update_data.items():
        setattr(prod, field, value)
    db.commit()
    db.refresh(prod)
    return prod


@router.delete("/{producto_id}", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_producto(
    producto_id: int,
    db: Session = Depends(get_db),
    _: Usuario = Depends(get_current_user),
):
    prod = db.query(Producto).filter(Producto.id == producto_id).first()
    if not prod:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    prod.activo = False
    db.commit()
