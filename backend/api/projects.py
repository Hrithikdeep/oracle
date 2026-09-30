import uuid

from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy.orm import Session

from auth import DEMO_USER_PASSWORD, hash_password
from database import get_db
from models.project import Project
from models.user import User

router = APIRouter()

# Every project belongs to the same placeholder system user used everywhere
# else in the app (see agents.orchestrator.SYSTEM_USER_EMAIL) — this app is
# single-user, projects aren't per-account yet.
SYSTEM_USER_EMAIL = "system@oracle.local"


def _get_or_create_system_user(db: Session) -> User:
    user = db.query(User).filter(User.email == SYSTEM_USER_EMAIL).first()
    if user is None:
        # Defensive: only runs if the seeded row is ever missing — see the
        # matching comment in agents/orchestrator.py.
        user = User(email=SYSTEM_USER_EMAIL, name="System", password_hash=hash_password(DEMO_USER_PASSWORD))
        db.add(user)
        db.flush()
    return user


@router.get("")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.created_at.desc()).all()
    return [
        {"id": str(p.id), "name": p.name, "created_at": p.created_at}
        for p in projects
    ]


@router.post("")
def create_project(name: str = Form(...), db: Session = Depends(get_db)):
    if not name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    user = _get_or_create_system_user(db)

    project = Project(user_id=user.id, name=name.strip())
    db.add(project)
    db.commit()
    db.refresh(project)

    return {"id": str(project.id), "name": project.name, "created_at": project.created_at}
