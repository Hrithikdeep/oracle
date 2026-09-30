from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.auth import router as auth_router
from api.documents import router as documents_router
from api.evidence import router as evidence_router
from api.financial_observations import router as financial_observations_router
from api.findings import router as findings_router
from api.projects import router as projects_router
from api.recheck import router as recheck_router
from api.research import router as research_router
from api.risks import router as risks_router
from auth import get_current_user
from config import CORS_ALLOW_ORIGIN_REGEX, CORS_ALLOWED_ORIGINS

app = FastAPI()

# Every router below except auth itself requires a valid JWT — applied once
# per router via FastAPI's router-level `dependencies`, rather than adding
# Depends(get_current_user) to each of the 13 route functions individually.
_auth_dep = [Depends(get_current_user)]

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(research_router, prefix="/research", tags=["research"], dependencies=_auth_dep)
app.include_router(recheck_router, prefix="/research", tags=["recheck"], dependencies=_auth_dep)
app.include_router(projects_router, prefix="/projects", tags=["projects"], dependencies=_auth_dep)
app.include_router(documents_router, prefix="/documents", tags=["documents"], dependencies=_auth_dep)
app.include_router(findings_router, prefix="/findings", tags=["findings"], dependencies=_auth_dep)
app.include_router(risks_router, prefix="/risks", tags=["risks"], dependencies=_auth_dep)
app.include_router(evidence_router, prefix="/evidence", tags=["evidence"], dependencies=_auth_dep)
app.include_router(
    financial_observations_router,
    prefix="/financial-observations",
    tags=["financial-observations"],
    dependencies=_auth_dep,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_origin_regex=CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}
