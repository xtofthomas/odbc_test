"""Backend minimal pour tester une connexion ODBC.

Lancé par Electron :  backend.exe --port 51234 --watch-stdin
En développement   :  python app.py --port 8765
Variables d'environnement :
  APP_TOKEN   jeton partagé avec Electron (obligatoire dans chaque requête, en-tête X-Token)
  APP_CONFIG  chemin du fichier config.json
"""
import argparse
import datetime as dt
import decimal
import json
import os
import sys
import threading
import time
import uuid
from pathlib import Path

# Avec PyInstaller --noconsole, stdout/stderr valent None et uvicorn plante au démarrage.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import pyodbc
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

TOKEN = os.environ.get("APP_TOKEN", "")
CONFIG_PATH = Path(os.environ.get("APP_CONFIG", Path(__file__).with_name("config.json")))


def check_token(x_token: str = Header(default="")):
    # Sur un Terminal Server, toutes les sessions partagent 127.0.0.1 :
    # le jeton empêche un autre utilisateur d'appeler ce backend.
    if TOKEN and x_token != TOKEN:
        raise HTTPException(status_code=401, detail="Jeton invalide")


app = FastAPI(title="ODBC test", dependencies=[Depends(check_token)])


# ---------- utilitaires ----------

def load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"connection_string": ""}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def to_json_value(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        b = bytes(v)
        return "0x" + b[:64].hex() + ("…" if len(b) > 64 else "")
    return str(v)


def connect(conn_str: str):
    if not conn_str.strip():
        raise HTTPException(status_code=400, detail="Chaîne de connexion vide")
    try:
        # timeout = délai de connexion (login timeout), en secondes
        return pyodbc.connect(conn_str, timeout=10, autocommit=False)
    except pyodbc.Error as e:
        raise HTTPException(status_code=400, detail=f"Connexion impossible : {e}")


# ---------- modèles ----------

class ConfigIn(BaseModel):
    connection_string: str


class TestIn(BaseModel):
    connection_string: str


class QueryIn(BaseModel):
    connection_string: str
    sql: str
    max_rows: int = 200


# ---------- routes ----------

@app.get("/health")
def health():
    return {"ok": True, "python": sys.version.split()[0], "pyodbc": pyodbc.version}


@app.get("/drivers")
def drivers():
    """Pilotes ODBC installés sur la machine (pas besoin d'être admin pour les lister)."""
    return {"drivers": pyodbc.drivers()}


@app.get("/dsns")
def dsns():
    try:
        return {"dsns": pyodbc.dataSources()}
    except pyodbc.Error:
        return {"dsns": {}}


@app.get("/config")
def get_config():
    return load_config()


@app.put("/config")
def put_config(body: ConfigIn):
    cfg = load_config()
    cfg["connection_string"] = body.connection_string
    save_config(cfg)
    return {"saved": True, "path": str(CONFIG_PATH)}


@app.post("/test")
def test(body: TestIn):
    t0 = time.perf_counter()
    cn = connect(body.connection_string)
    elapsed = round((time.perf_counter() - t0) * 1000)
    try:
        def info(code):
            try:
                return cn.getinfo(code)
            except pyodbc.Error:
                return None

        return {
            "ok": True,
            "connect_ms": elapsed,
            "dbms": info(pyodbc.SQL_DBMS_NAME),
            "dbms_version": info(pyodbc.SQL_DBMS_VER),
            "driver": info(pyodbc.SQL_DRIVER_NAME),
            "driver_version": info(pyodbc.SQL_DRIVER_VER),
            "server": info(pyodbc.SQL_SERVER_NAME),
            "database": info(pyodbc.SQL_DATABASE_NAME),
            "user": info(pyodbc.SQL_USER_NAME),
        }
    finally:
        cn.close()


@app.post("/query")
def query(body: QueryIn):
    cn = connect(body.connection_string)
    try:
        cur = cn.cursor()
        t0 = time.perf_counter()
        try:
            cur.execute(body.sql)
        except pyodbc.Error as e:
            raise HTTPException(status_code=400, detail=f"Erreur SQL : {e}")
        elapsed = round((time.perf_counter() - t0) * 1000)

        if cur.description is None:
            return {"columns": [], "rows": [], "rowcount": cur.rowcount,
                    "elapsed_ms": elapsed, "truncated": False}

        columns = [c[0] for c in cur.description]
        limit = max(1, min(body.max_rows, 5000))
        raw = cur.fetchmany(limit + 1)
        truncated = len(raw) > limit
        rows = [[to_json_value(v) for v in r] for r in raw[:limit]]
        return {"columns": columns, "rows": rows, "rowcount": len(rows),
                "elapsed_ms": elapsed, "truncated": truncated}
    finally:
        # Outil de test : on annule systématiquement toute modification.
        try:
            cn.rollback()
        except pyodbc.Error:
            pass
        cn.close()


# ---------- démarrage ----------

def watch_stdin():
    """Quitte quand Electron se ferme (le tube stdin est alors fermé)."""
    try:
        while sys.stdin.read(1):
            pass
    finally:
        os._exit(0)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--watch-stdin", action="store_true")
    args = p.parse_args()

    if args.watch_stdin and sys.stdin is not None:
        threading.Thread(target=watch_stdin, daemon=True).start()

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_config=None, log_level="warning")


if __name__ == "__main__":
    main()
