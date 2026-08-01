from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.core.security import create_access_token, hash_password, verify_password
from app.models.usuario import RolEnum, Usuario
from app.schemas.usuario import LoginRequest, TokenResponse, UsuarioCreate, UsuarioOut

router = APIRouter(prefix="/auth", tags=["Autenticacion"])


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(Usuario).filter(Usuario.username == data.username).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )
    if not user.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario inactivo",
        )
    token = create_access_token({"sub": str(user.id), "rol": user.rol.value})
    return TokenResponse(access_token=token, usuario=UsuarioOut.model_validate(user))


@router.post(
    "/register",
    response_model=UsuarioOut,
    status_code=status.HTTP_201_CREATED,
)
def register(
    data: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_roles(RolEnum.admin)),
):
    if db.query(Usuario).filter(Usuario.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username ya registrado")
    if db.query(Usuario).filter(Usuario.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email ya registrado")

    user = Usuario(
        username=data.username,
        email=data.email,
        hashed_password=hash_password(data.password),
        nombre_completo=data.nombre_completo,
        rol=data.rol,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UsuarioOut.model_validate(user)


@router.get("/me", response_model=UsuarioOut)
def me(current_user: Usuario = Depends(get_current_user)):
    return UsuarioOut.model_validate(current_user)
