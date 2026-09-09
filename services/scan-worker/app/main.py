"""Worker privado de leitura óptica PTR1.

O serviço não persiste os arquivos e recebe do n8n apenas um despacho opaco.
Baixa o original pela API interna autenticada, produz o resultado estruturado e
o devolve para a mesma API. Nesta primeira versão, somente páginas objetivas
PTR1 recebem leitura automática; páginas incertas seguem para o professor.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Literal

import cv2
import fitz
import httpx
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

CANONICAL_WIDTH = 2100
CANONICAL_HEIGHT = 2970
PX_PER_MM = CANONICAL_WIDTH / 210
MIN_QUALITY = 0.65
# Mesmas coordenadas físicas do gerador `sheetPdf.ts`, aferidas no cartão
# impresso PTR1. Só a área interna da bolha entra no cálculo, não sua borda.
OBJECTIVE_LEFT_BUBBLE_X_MM = 46.3
OBJECTIVE_RIGHT_BUBBLE_X_MM = 145.0
OBJECTIVE_FIRST_BUBBLE_Y_MM = 137.6
OBJECTIVE_ROW_GAP_MM = 13.0


class DispatchQuestion(BaseModel):
    number: int
    alternatives: int | None = None


class DispatchPage(BaseModel):
    id: int
    pageIndex: int


class ExpectedSheetPage(BaseModel):
    pageNumber: int
    expectedPageType: Literal['objective', 'discursive']
    questions: list[DispatchQuestion]


class Dispatch(BaseModel):
    schemaVersion: Literal['PTR1_SCAN_DISPATCH_V1']
    attemptId: int
    uploadId: int
    examId: int
    sha256: str
    pageCount: int
    contentPath: str
    pages: list[DispatchPage]
    sheetLayout: list[ExpectedSheetPage]


@dataclass
class PreparedImage:
    image: np.ndarray
    qr_token: str | None
    quality_score: float
    exception_code: str | None


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f'{name} não configurado')
    return value


def hmac_secret() -> bytes:
    value = require_env('N8N_SCAN_SHARED_SECRET')
    try:
        secret = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    except ValueError as exc:
        raise RuntimeError('N8N_SCAN_SHARED_SECRET inválido') from exc
    if len(secret) < 32:
        raise RuntimeError('N8N_SCAN_SHARED_SECRET inválido')
    return secret


def signed_headers(method: str, path_and_query: str, body: bytes = b'') -> dict[str, str]:
    timestamp = str(int(time.time()))
    canonical = '\n'.join((method.upper(), path_and_query, timestamp, hashlib.sha256(body).hexdigest()))
    signature = hmac.new(hmac_secret(), canonical.encode(), hashlib.sha256).digest()
    return {
        'X-ProvaTri-Timestamp': timestamp,
        'X-ProvaTri-Signature': base64.urlsafe_b64encode(signature).rstrip(b'=').decode(),
    }


def decode_image(raw: bytes, content_type: str) -> np.ndarray:
    if content_type == 'application/pdf':
        document = fitz.open(stream=raw, filetype='pdf')
        if document.page_count != 1:
            raise ValueError('PDF_MULTIPAGE_UNSUPPORTED')
        pixmap = document.load_page(0).get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = cv2.imdecode(np.frombuffer(pixmap.tobytes('png'), dtype=np.uint8), cv2.IMREAD_COLOR)
    else:
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ValueError('IMAGE_DECODE_FAILED')
    return image


def find_markers(image: np.ndarray) -> np.ndarray | None:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    threshold = cv2.threshold(gray, 70, 255, cv2.THRESH_BINARY_INV)[1]
    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.shape[0] * image.shape[1]
    candidates: list[tuple[float, tuple[float, float]]] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = width * height
        ratio = width / max(height, 1)
        if image_area * 0.00008 <= area <= image_area * 0.004 and 0.65 <= ratio <= 1.35:
            candidates.append((area, (x + width / 2, y + height / 2)))
    if len(candidates) < 4:
        return None
    height, width = image.shape[:2]
    corners = [(0, 0), (width, 0), (0, height), (width, height)]
    selected = [min(candidates, key=lambda item: (item[1][0] - cx) ** 2 + (item[1][1] - cy) ** 2)[1] for cx, cy in corners]
    if len({(round(x), round(y)) for x, y in selected}) != 4:
        return None
    return np.float32(selected)


def normalize_from_markers(image: np.ndarray) -> np.ndarray | None:
    source = find_markers(image)
    if source is None:
        return None
    marker_center = 15.5 * PX_PER_MM
    destination = np.float32([
        [marker_center, marker_center],
        [CANONICAL_WIDTH - marker_center, marker_center],
        [marker_center, CANONICAL_HEIGHT - marker_center],
        [CANONICAL_WIDTH - marker_center, CANONICAL_HEIGHT - marker_center],
    ])
    matrix = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(image, matrix, (CANONICAL_WIDTH, CANONICAL_HEIGHT), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


def read_qr(image: np.ndarray) -> tuple[str | None, np.ndarray]:
    detector = cv2.QRCodeDetector()
    candidates = [image, cv2.rotate(image, cv2.ROTATE_180), cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE), cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)]
    decoded: list[tuple[float, str, np.ndarray]] = []
    for candidate in candidates:
        token, points, _ = detector.detectAndDecode(candidate)
        if token.startswith('PTR1.'):
            # O OpenCV é capaz de decodificar um QR de ponta-cabeça. Isso não
            # basta: a página canônica precisa ficar na orientação do layout
            # para OMR e os recortes discursivos usarem as coordenadas PTR1.
            # O QR do PTR1 foi desenhado no quadrante superior direito; entre
            # rotações válidas, usamos a posição detectada como desempate.
            height, width = candidate.shape[:2]
            if points is None:
                score = float('-inf')
            else:
                centroid = np.asarray(points, dtype=np.float32).reshape(-1, 2).mean(axis=0)
                expected = np.asarray([width * 0.84, height * 0.15], dtype=np.float32)
                score = -float(np.linalg.norm((centroid - expected) / np.asarray([width, height], dtype=np.float32)))
            decoded.append((score, token, candidate))
    if decoded:
        _, token, oriented = max(decoded, key=lambda item: item[0])
        return token, oriented
    return None, image


def page_number_from_qr(token: str | None) -> int | None:
    if not token:
        return None
    parts = token.split('.')
    if len(parts) < 3 or parts[0] != 'PTR1':
        return None
    try:
        page_number = int(parts[2])
    except ValueError:
        return None
    return page_number if page_number > 0 else None


def quality_score(image: np.ndarray, has_markers: bool, has_qr: bool) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    sharpness = min(cv2.Laplacian(gray, cv2.CV_64F).var() / 120.0, 1.0)
    contrast = min(float(gray.std()) / 50.0, 1.0)
    return round(float(max(0.0, min(1.0, 0.2 * sharpness + 0.2 * contrast + 0.3 * has_markers + 0.3 * has_qr))), 3)


def mm(value: float) -> int:
    return round(value * PX_PER_MM)


def bubble_fill(gray: np.ndarray, x_mm: float, y_mm: float) -> float:
    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.circle(mask, (mm(x_mm), mm(y_mm)), mm(2.0), 255, -1)
    return float(255 - cv2.mean(gray, mask=mask)[0]) / 255.0


def objective_readings(image: np.ndarray, questions: list[DispatchQuestion]) -> list[dict[str, Any]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    readings: list[dict[str, Any]] = []
    for index, question in enumerate(questions):
        column, row = (0, index) if index < 8 else (1, index - 8)
        x = OBJECTIVE_LEFT_BUBBLE_X_MM if column == 0 else OBJECTIVE_RIGHT_BUBBLE_X_MM
        y = OBJECTIVE_FIRST_BUBBLE_Y_MM + row * OBJECTIVE_ROW_GAP_MM
        option_count = question.alternatives or 5
        values = [bubble_fill(gray, x + option * 8.5, y) for option in range(option_count)]
        ordered = sorted(values, reverse=True)
        top, gap = ordered[0], ordered[0] - ordered[1]
        if top < 0.20 or gap < 0.08:
            readings.append({'questionNumber': question.number, 'kind': 'objective', 'suggestedLetter': None, 'confidence': round(min(1.0, gap / 0.25), 3), 'exceptionCode': 'OMR_AMBIGUOUS', 'modelReference': 'ptr1-omr-v1'})
            continue
        confidence = min(1.0, 0.45 + gap * 2.2 + top * 0.25)
        readings.append({'questionNumber': question.number, 'kind': 'objective', 'suggestedLetter': 'ABCDE'[values.index(top)], 'confidence': round(confidence, 3), 'modelReference': 'ptr1-omr-v1'})
    return readings


def prepare(image: np.ndarray) -> PreparedImage:
    normalized = normalize_from_markers(image)
    has_markers = normalized is not None
    token, oriented = read_qr(normalized if normalized is not None else image)
    score = quality_score(oriented, has_markers, token is not None)
    exception = 'QR_MISSING' if token is None else 'MARKERS_MISSING' if not has_markers else 'LOW_QUALITY' if score < MIN_QUALITY else None
    return PreparedImage(oriented, token, score, exception)


def encode_jpeg(image: np.ndarray) -> bytes:
    success, encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not success:
        raise ValueError('IMAGE_ENCODE_FAILED')
    return encoded.tobytes()


async def upload_artifact(client: httpx.AsyncClient, base_url: str, path: str, image: np.ndarray) -> None:
    body = encode_jpeg(image)
    response = await client.put(f'{base_url}{path}', content=body, headers={**signed_headers('PUT', path, body), 'Content-Type': 'image/jpeg'})
    response.raise_for_status()


def objective_crop(image: np.ndarray, questions: list[DispatchQuestion], question_number: int) -> np.ndarray | None:
    try:
        index = next(index for index, question in enumerate(questions) if question.number == question_number)
    except StopIteration:
        return None
    column, row = (0, index) if index < 8 else (1, index - 8)
    center_x = OBJECTIVE_LEFT_BUBBLE_X_MM if column == 0 else OBJECTIVE_RIGHT_BUBBLE_X_MM
    center_y = OBJECTIVE_FIRST_BUBBLE_Y_MM + row * OBJECTIVE_ROW_GAP_MM
    left = mm(center_x - 7)
    top = mm(center_y - 5.5)
    right = mm(center_x + 45)
    bottom = mm(center_y + 5.5)
    return image[top:bottom, left:right]


async def process(dispatch: Dispatch) -> dict[str, Any]:
    if not dispatch.contentPath.startswith('/api/internal/scan-uploads/'):
        raise ValueError('contentPath inválido')
    content_path = dispatch.contentPath
    base_url = require_env('PROVATRI_INTERNAL_BASE_URL').rstrip('/')
    async with httpx.AsyncClient(timeout=60) as client:
        source = await client.get(f'{base_url}{content_path}', headers=signed_headers('GET', content_path))
        source.raise_for_status()
        image = decode_image(source.content, source.headers.get('content-type', '').split(';', 1)[0])
        prepared = prepare(image)
        sheet_page_number = page_number_from_qr(prepared.qr_token)
        expected = next((page for page in dispatch.sheetLayout if page.pageNumber == sheet_page_number), None)
        page_type = expected.expectedPageType if expected else 'unknown'
        pages = []
        for page in dispatch.pages:
            readings = objective_readings(prepared.image, expected.questions) if expected and expected.expectedPageType == 'objective' and prepared.exception_code is None else []
            pages.append({'pageIndex': page.pageIndex, 'qrToken': prepared.qr_token, 'pageType': page_type, 'qualityScore': prepared.quality_score, 'exceptionCode': prepared.exception_code, 'readings': readings})
        payload = {'uploadSha256': dispatch.sha256, 'pages': pages}
        body = json.dumps(payload, separators=(',', ':')).encode()
        result_path = f'/api/internal/scan-attempts/{dispatch.attemptId}/result'
        result = await client.post(f'{base_url}{result_path}', content=body, headers={**signed_headers('POST', result_path, body), 'Content-Type': 'application/json'})
        result.raise_for_status()
        accepted = result.json()
        # A página normalizada fica privada e auditável mesmo quando o QR ou a
        # leitura são inconclusivos. Só recortes de leituras já persistidas são
        # anexados, usando os IDs opacos retornados no callback.
        for page in dispatch.pages:
            canonical_path = f'/api/internal/scan-pages/{page.id}/canonical?attemptId={dispatch.attemptId}'
            await upload_artifact(client, base_url, canonical_path, prepared.image)
        refs = accepted.get('readingRefs', [])
        pages_by_index = {page.pageIndex: page for page in dispatch.pages}
        for reference in refs:
            page = pages_by_index.get(reference.get('pageIndex'))
            if not page or not expected or expected.expectedPageType != 'objective':
                continue
            crop = objective_crop(prepared.image, expected.questions, reference.get('questionNumber'))
            if crop is None or crop.size == 0:
                continue
            crop_path = f'/api/internal/scan-readings/{reference["id"]}/crop?attemptId={dispatch.attemptId}'
            await upload_artifact(client, base_url, crop_path, crop)
        return accepted


app = FastAPI(title='ProvaTRI Scan Worker', docs_url=None, redoc_url=None)


@app.get('/healthz')
async def healthz() -> dict[str, str]:
    return {'status': 'ok'}


@app.post('/jobs')
async def jobs(dispatch: Dispatch, x_provatri_worker_token: str | None = Header(default=None)) -> dict[str, Any]:
    if not x_provatri_worker_token or not hmac.compare_digest(x_provatri_worker_token, require_env('SCAN_WORKER_TOKEN')):
        raise HTTPException(status_code=401, detail='Não autorizado')
    if dispatch.pageCount != len(dispatch.pages) or len(dispatch.pages) != 1 or not dispatch.sheetLayout:
        raise HTTPException(status_code=400, detail='Despacho inválido')
    try:
        return await process(dispatch)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail='Falha ao acessar ProvaTRI') from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
