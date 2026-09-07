#!/usr/bin/env python3
"""Download and normalize Spain's public MITECO/RIPREE EV charging dataset.

This is a PRE-INTEGRATION source collector for Tesla Charge Companion.
It does not publish to the TCC runtime. The official export is kept as a raw
snapshot and a normalized JSON catalogue is produced for later REVE enrichment.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXPORT_URL = "https://energia.serviciosmin.gob.es/Ripree/ExportarInstalaciones/Export"
DATA_DIR = Path("data/spain_reve")
RAW_PATH = DATA_DIR / "miteco_ripree_raw.bin"
NORMALIZED_PATH = DATA_DIR / "miteco_ripree_normalized.json.gz"
META_PATH = DATA_DIR / "miteco_metadata.json"


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def norm_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def first(row: dict[str, Any], aliases: list[str]) -> str | None:
    indexed = {norm_key(k): v for k, v in row.items()}
    for alias in aliases:
        v = indexed.get(norm_key(alias))
        if v is not None and str(v).strip() != "":
            return str(v).strip()
    return None


def to_float(value: str | None) -> float | None:
    if value is None:
        return None
    s = value.strip().replace(" ", "")
    if not s:
        return None
    if "," in s and "." not in s:
        s = s.replace(",", ".")
    elif "," in s and "." in s and s.rfind(",") > s.rfind("."):
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def decode_text(blob: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return blob.decode(enc)
        except UnicodeDecodeError:
            pass
    raise RuntimeError("Could not decode MITECO export")


def parse_export(blob: bytes) -> tuple[list[dict[str, str]], str, list[str]]:
    text = decode_text(blob).lstrip("\ufeff\r\n \t")
    if text.startswith("<"):
        raise RuntimeError("MITECO endpoint returned XML; CSV parser update required after inspecting the live schema")

    sample = text[:10000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ";"

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        raise RuntimeError("MITECO CSV has no header")
    rows = [{str(k): ("" if v is None else str(v)) for k, v in row.items()} for row in reader]
    return rows, delimiter, [str(x) for x in reader.fieldnames]


def station_id(row: dict[str, str], index: int) -> str:
    direct = first(row, [
        "id instalacion", "id_instalacion", "identificador instalacion", "codigo instalacion",
        "id punto recarga", "id_punto_recarga", "evse id", "evse_id", "codigo punto",
    ])
    if direct:
        return f"MITECO:{direct}"
    material = "|".join(filter(None, [
        first(row, ["operador", "cpo", "titular explotacion", "titular de la explotacion"]),
        first(row, ["direccion", "domicilio"]),
        first(row, ["municipio", "localidad"]),
        first(row, ["codigo postal", "cp"]),
        first(row, ["latitud", "latitude"]),
        first(row, ["longitud", "longitude"]),
    ]))
    if not material:
        material = json.dumps(row, ensure_ascii=False, sort_keys=True) + f"|{index}"
    return "MITECO:AUTO:" + hashlib.sha1(material.encode("utf-8")).hexdigest()[:20]


def normalize(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, row in enumerate(rows, start=1):
        lat = to_float(first(row, ["latitud", "latitude", "coord_y", "y"]));
        lon = to_float(first(row, ["longitud", "longitude", "coord_x", "x"]));
        power = to_float(first(row, ["potencia maxima", "potencia_maxima", "potencia kw", "potencia", "power_kw"]));
        operator = first(row, ["operador", "cpo", "nombre operador", "titular explotacion", "titular de la explotacion", "empresa operadora"])
        owner = first(row, ["titular", "propietario", "titular instalacion", "titular de la instalacion"])
        name = first(row, ["nombre instalacion", "nombre", "denominacion", "emplazamiento"])
        address = first(row, ["direccion", "domicilio", "via"])
        city = first(row, ["municipio", "localidad", "poblacion"])
        province = first(row, ["provincia"])
        region = first(row, ["comunidad autonoma", "ccaa", "region"])
        postal = first(row, ["codigo postal", "cp", "postal_code"])
        connector = first(row, ["tipo conector", "tipo de conector", "conector", "connector_type"])
        charge_type = first(row, ["tipo carga", "tipo de carga", "charge_type"])
        format_type = first(row, ["formato conector", "formato de conector", "connector_format"])
        voltage = to_float(first(row, ["voltaje", "voltage", "tension"]));
        amperage = to_float(first(row, ["intensidad", "amperaje", "amperage", "current"]));

        out.append({
            "id": station_id(row, idx),
            "country": "ES",
            "source": "MITECO_RIPREE",
            "operatorRaw": operator,
            "ownerRaw": owner,
            "name": name,
            "address": address,
            "city": city,
            "province": province,
            "region": region,
            "postalCode": postal,
            "lat": lat,
            "lon": lon,
            "connectorType": connector,
            "connectorFormat": format_type,
            "chargeType": charge_type,
            "powerKw": power,
            "voltageV": voltage,
            "amperageA": amperage,
            "raw": row,
        })
    return out


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(EXPORT_URL, headers={"User-Agent": "TeslaChargeCompanion-MITECO/1.0", "Accept": "text/csv,application/csv,text/plain,*/*"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        blob = resp.read()
        content_type = resp.headers.get("content-type")
        content_disposition = resp.headers.get("content-disposition")

    if not blob:
        raise RuntimeError("MITECO export is empty")
    RAW_PATH.write_bytes(blob)

    rows, delimiter, columns = parse_export(blob)
    normalized = normalize(rows)
    payload = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "MITECO_RIPREE",
        "sourceUrl": EXPORT_URL,
        "updatedAt": now_utc(),
        "integrationStatus": "PRE_INTEGRATION_ONLY",
        "rowCount": len(normalized),
        "stations": normalized,
    }
    with NORMALIZED_PATH.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
            gz.write((json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))

    metadata = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "MITECO_RIPREE",
        "sourceUrl": EXPORT_URL,
        "downloadedAt": now_utc(),
        "contentType": content_type,
        "contentDisposition": content_disposition,
        "bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "delimiter": delimiter,
        "columns": columns,
        "rowCount": len(rows),
        "normalizedCount": len(normalized),
        "integrationStatus": "PRE_INTEGRATION_ONLY",
    }
    META_PATH.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
