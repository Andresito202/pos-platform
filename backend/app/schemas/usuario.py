from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.usuario import RolEnum


class UsuarioCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    nombre_completo: str
    rol: RolEnum = RolEnum.cajero


class UsuarioOut(BaseModel):
    id: int
    username: str
    email: str
    nombre_completo: str
    rol: RolEnum
    activo: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioOut
