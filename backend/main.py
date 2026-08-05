"""SiteInformation API entry point.

Wires the FastAPI app together — CORS, then a `app.include_router(...)` call
per domain. Every request handler lives in a `routers/*.py` module; auth
dependencies are in `deps.py`; shared state (Supabase client, env constants,
in-memory caches, business helpers) is under `services/`.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.auth import router as auth_router
from routers.geocode import router as geocode_router
from routers.managing_entities import router as managing_entities_router
from routers.org import router as org_router
from routers.sites import router as sites_router
from routers.sso import router as sso_router
from routers.statistics import router as statistics_router
from routers.users import router as users_router

app = FastAPI(title="SiteInformation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://192.168.0.6:3000",
        "http://54.116.15.150",
        "https://site-info-umber.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(org_router)
app.include_router(sites_router)
app.include_router(statistics_router)
app.include_router(managing_entities_router)
app.include_router(geocode_router)
app.include_router(sso_router)
