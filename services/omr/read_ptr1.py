#!/usr/bin/env python3
"""Local reader for the fixed PTR1 answer sheet.

It never sends a scan outside the server. ZXing is the primary QR decoder,
OpenCV is the bounded fallback, and the four corner markers rectify the page
before bubble measurements.
"""
import argparse
import json
import sys
import time
import cv2
import numpy as np

try:
    import zxingcpp
except ImportError:
    zxingcpp = None

READER_VERSION = "ptr1-qr-v5-geometry-safe"
QR_DECODE_BUDGET_MS = 4_500

MM = 300 / 25.4
WIDTH, HEIGHT = round(210 * MM), round(297 * MM)
MARKER_CENTER = round(15.5 * MM)
# Fiducials are printed in the outer corners.  A candidate from the opposite
# side of the page is never a valid replacement, even when one real marker is
# fragmented and the candidate detector has only three good points.
MARKER_X_BAND = .32
MARKER_Y_BAND = .28
TARGET = np.float32([
    [MARKER_CENTER, MARKER_CENTER],
    [WIDTH - MARKER_CENTER, MARKER_CENTER],
    [MARKER_CENTER, HEIGHT - MARKER_CENTER],
    [WIDTH - MARKER_CENTER, HEIGHT - MARKER_CENTER],
])

def fail(code):
    return {"qrToken": None, "qrFailureCode": "QR_NOT_FOUND", "qrRotation": None, "qualityScore": 0.0, "exceptionCode": code, "bubbles": []}

def marker_centers(gray):
    _, threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    # Scanners with a white page border often break the lower-right fiducial
    # into small islands because the gray marker is close to the page tone.
    # A tiny close reconnects those islands without touching the QR/modules or
    # changing the coordinates used for rectification.
    closed = cv2.morphologyEx(threshold, cv2.MORPH_CLOSE, kernel)
    for thresh_img in [threshold, cv2.morphologyEx(threshold, cv2.MORPH_OPEN, kernel), closed]:
        contours, _ = cv2.findContours(thresh_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        h, w = gray.shape[:2]
        candidates = []
        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            area = cw * ch
            ratio = cw / max(ch, 1)
            contour_area = cv2.contourArea(contour)
            extent = contour_area / max(area, 1)
            if (area < (w * h * 0.00008) or area > (w * h * 0.015)
                    or not .65 < ratio < 1.35 or extent < .55):
                continue
            candidates.append((x + cw / 2, y + ch / 2, area))
        quadrants = [
            (0, 0, lambda x, y: x <= w * MARKER_X_BAND and y <= h * MARKER_Y_BAND),
            (w, 0, lambda x, y: x >= w * (1 - MARKER_X_BAND) and y <= h * MARKER_Y_BAND),
            (0, h, lambda x, y: x <= w * MARKER_X_BAND and y >= h * (1 - MARKER_Y_BAND)),
            (w, h, lambda x, y: x >= w * (1 - MARKER_X_BAND) and y >= h * (1 - MARKER_Y_BAND)),
        ]
        result = []
        for qx, qy, in_band in quadrants:
            corner_candidates = [point for point in candidates if in_band(point[0], point[1])]
            result.append(min(corner_candidates, key=lambda point: (point[0] - qx) ** 2 + (point[1] - qy) ** 2, default=None))
        if any(point is None for point in result) or len({(round(p[0]), round(p[1])) for p in result}) != 4:
            continue
        points = np.float32([[p[0], p[1]] for p in result])
        if validate_marker_geometry(points, gray.shape):
            return points
    return None


def validate_marker_geometry(points, shape):
    """Reject false four-point sets before they can create a bad homography."""
    if points is None or len(points) != 4 or not np.isfinite(points).all():
        return False
    height, width = shape[:2]
    top_left, top_right, bottom_left, bottom_right = points
    ordered = np.float32([top_left, top_right, bottom_right, bottom_left])
    area = abs(float(cv2.contourArea(ordered)))
    if area < width * height * 0.30:
        return False
    top = float(np.linalg.norm(top_right - top_left))
    bottom = float(np.linalg.norm(bottom_right - bottom_left))
    left = float(np.linalg.norm(bottom_left - top_left))
    right = float(np.linalg.norm(bottom_right - top_right))
    edges = [top, bottom, left, right]
    if min(edges) < min(width, height) * 0.35:
        return False
    if not 0.45 <= top / max(bottom, 1.0) <= 2.2:
        return False
    if not 0.45 <= left / max(right, 1.0) <= 2.2:
        return False
    # Opposite edges must have the same orientation.  This rejects crossed
    # quadrilaterals and points accidentally pulled into the QR region.
    def cross(first, second):
        return float(first[0] * second[1] - first[1] * second[0])

    cross_top = cross(top_right - top_left, bottom_left - top_left)
    cross_right = cross(bottom_right - top_right, top_left - top_right)
    cross_bottom = cross(bottom_left - bottom_right, top_right - bottom_right)
    cross_left = cross(top_left - bottom_left, bottom_right - bottom_left)
    if min(cross_top, cross_right, cross_bottom, cross_left) <= 0:
        return False
    return True

def rectify(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    points = marker_centers(gray)
    if points is None or not validate_marker_geometry(points, image.shape):
        return image, False
    matrix = cv2.getPerspectiveTransform(points, TARGET)
    return cv2.warpPerspective(image, matrix, (WIDTH, HEIGHT), borderValue=(255, 255, 255)), True

def _is_ptr1(value):
    return isinstance(value, str) and value.startswith("PTR1.")


def _zxing_results(image, binarizer, try_invert=False):
    """Run ZXing with a bounded, QR-only configuration.

    v3 exposes inversion and error results. The compatibility branch keeps the
    reader usable with a cached v2 wheel while the Docker image is rebuilt.
    """
    if zxingcpp is None:
        return []
    kwargs = {
        "formats": zxingcpp.BarcodeFormat.QRCode,
        # Rotations and scales are controlled by this module. Leaving these
        # ZXing heuristics enabled makes it scan the same noisy crop again
        # internally and was the source of OMR_TIMEOUT on upload #2612.
        "try_rotate": False,
        "try_downscale": False,
        "binarizer": binarizer,
        "return_errors": True,
    }
    try:
        kwargs["try_invert"] = try_invert
        return zxingcpp.read_barcodes(np.ascontiguousarray(image), **kwargs)
    except TypeError:
        kwargs.pop("try_invert", None)
        return zxingcpp.read_barcodes(np.ascontiguousarray(image), **kwargs)
    except Exception:
        return []


def _qr_regions(image):
    """Return tight-to-wide top-right regions for an upright PTR1 page."""
    height, width = image.shape[:2]
    regions = [
        # PTR1 has a fixed QR position. The precise crop keeps the decoder
        # away from the speckled answer areas and makes each C++ call bounded.
        ("precise", image[round(height * .028506):round(height * .285061), round(width * .665323):]),
        ("tight", image[int(height * .02):int(height * .36), int(width * .56):]),
        # Retained only as a last ZXing fallback for scans with heavy skew or
        # a partially cropped page. It is never sent to OpenCV.
        ("wide", image[:int(height * .55), int(width * .32):]),
    ]
    return [(name, region) for name, region in regions if region.size]


def _qr_text_from_zxing_with_diagnostics(image):
    """Decode one crop and retain diagnostics without accepting bad payloads."""
    if zxingcpp is None:
        return None, False
    had_error = False
    binarizers = [
        getattr(zxingcpp.Binarizer, "GlobalHistogram", None),
        getattr(zxingcpp.Binarizer, "LocalAverage", None),
        getattr(zxingcpp.Binarizer, "FixedThreshold", None),
        getattr(zxingcpp.Binarizer, "BoolCast", None),
    ]
    for binarizer in [item for item in binarizers if item is not None]:
        for result in _zxing_results(image, binarizer, False):
            value = getattr(result, "text", "") or ""
            if getattr(result, "error", None):
                had_error = True
            if _is_ptr1(value) and getattr(result, "valid", True):
                return value, had_error
    return None, had_error


def _qr_candidate_variants(region_name, image):
    """Yield a small, deterministic set of lossless QR crop variants.

    The scan #1972 regression demonstrated that the native crop contains all
    information needed by the decoder, but a small QR can benefit from module
    enlargement after rectification. The enlargement happens only in memory
    and only for the QR crop; the full page is never blurred or recompressed.
    """
    if image.size == 0:
        return
    yield image
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    yield gray
    yield cv2.medianBlur(gray, 3)
    # Scanner halftoning often changes the local background inside the quiet
    # zone.  Keep these operations confined to the QR crop; applying them to
    # the complete answer sheet damages the OMR bubbles.
    yield cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    yield cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY, 31, 5)
    if region_name not in {"precise", "tight"}:
        return
    # Alguns scanners transformam cada módulo em uma nuvem de pontos. Uma
    # suavização gaussiana forte, aplicada somente ao recorte do QR, recupera
    # a forma dos módulos sem alterar a página usada para OMR. A variante é
    # deliberadamente única e fica dentro do orçamento total.
    yield cv2.GaussianBlur(gray, (9, 9), 0)
    for scale, interpolation in ((2, cv2.INTER_NEAREST), (3, cv2.INTER_NEAREST),
                                 (2, cv2.INTER_CUBIC)):
        yield cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interpolation)


def decode_qr_robust(image):
    """Decode PTR1 with bounded work and two independent engines.

    QRCodeDetector can enter a very slow path on some perfectly legible PTR1
    codes. ZXing is attempted first; OpenCV is a small, bounded fallback.
    Never build an unbounded matrix of rotations, scales and filters here.
    """
    started = time.monotonic()
    deadline = started + QR_DECODE_BUDGET_MS / 1000
    attempts = 0
    had_checksum_error = False

    # O QR PTR1 fica no canto superior direito. Nunca entregue a página inteira
    # ao decoder: em algumas imagens o backend C++ percorre áreas sem código
    # por tempo indefinido antes de chegar ao QR visível.
    if image.shape[0] >= image.shape[1]:
        rotation_order = (0, 180, 90, 270)
    else:
        rotation_order = (90, 270, 0, 180)
    rotate_codes = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    orientations = [
        (image if rotation == 0 else cv2.rotate(image, rotate_codes[rotation]), rotation)
        for rotation in rotation_order
    ]
    for oriented, rotation in orientations:
        for region_name, candidate in _qr_regions(oriented):
            for candidate_variant in _qr_candidate_variants(region_name, candidate):
                if time.monotonic() >= deadline:
                    break
                attempts += 1
                value, had_error = _qr_text_from_zxing_with_diagnostics(candidate_variant)
                had_checksum_error = had_checksum_error or had_error
                if value:
                    return value, rotation, "zxing", attempts, round((time.monotonic() - started) * 1000)
            if time.monotonic() >= deadline:
                break
        if time.monotonic() >= deadline:
            break

    # OpenCV remains a useful independent fallback, but only on the two
    # bounded crops. Calling detectAndDecode on the old wide region can enter
    # an expensive contour search on a noisy page and defeat the timeout
    # protection of the worker.
    detector = cv2.QRCodeDetector()
    for oriented, rotation in orientations:
        for region_name, candidate in _qr_regions(oriented):
            if region_name == "wide" or time.monotonic() >= deadline:
                continue
            gray = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY)
            median = cv2.medianBlur(gray, 3)
            _, binary = cv2.threshold(median, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            candidates = [gray, median, binary]
            for candidate_variant in candidates:
                if time.monotonic() >= deadline:
                    break
                attempts += 1
                if candidate_variant.size == 0:
                    continue
                try:
                    val, _, _ = detector.detectAndDecode(candidate_variant)
                except cv2.error:
                    val = None
                if _is_ptr1(val):
                    return val, rotation, "opencv", attempts, round((time.monotonic() - started) * 1000)
            if time.monotonic() >= deadline:
                break
        if time.monotonic() >= deadline:
            break
    diagnostic_engine = "checksum_error" if had_checksum_error else "none"
    return None, 0, diagnostic_engine, attempts, round((time.monotonic() - started) * 1000)

def normalize_page(image):
    rot_map = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    # The marker layout is rotationally symmetric, so markers alone cannot
    # tell whether a landscape input came from a 90° or 270° feeder rotation.
    # Put every landscape scan into the canonical portrait geometry first;
    # the QR orientation pass below then selects the correct final direction.
    # Without this step, rectify() stretches a 3508x2480 image into the
    # 2480x3508 target and bubble coordinates become invalid even when the QR
    # itself decodes successfully.
    pre_rotation = 0
    working = image
    if image.shape[1] > image.shape[0]:
        working = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        pre_rotation = 270
    # Always inspect the original geometry first.  A valid QR is stronger
    # evidence of page orientation than a perspective guess, and this also
    # prevents a false marker from destroying a QR that was already readable.
    raw_qr, raw_rotation, raw_engine, raw_attempts, raw_duration_ms = decode_qr_robust(working)
    if raw_qr:
        oriented = cv2.rotate(working, rot_map[raw_rotation]) if raw_rotation else working
        normalized, markers_found = rectify(oriented)
        if not markers_found:
            # A page with a readable QR but damaged fiducials remains useful
            # for identity and manual review. Never invent a homography.
            normalized = oriented
        qr_text, rotation = raw_qr, raw_rotation
        qr_engine, qr_attempts, qr_duration_ms = raw_engine, raw_attempts, raw_duration_ms
    else:
        # If the native QR pass fails, a validated rectification can enlarge
        # the modules into the canonical 300-DPI geometry and recover noisy
        # scans.  Invalid marker sets return the original image unchanged.
        normalized, markers_found = rectify(working)
        if markers_found:
            qr_text, rotation, qr_engine, qr_attempts, qr_duration_ms = decode_qr_robust(normalized)
            if qr_text and rotation != 0:
                normalized = cv2.rotate(normalized, rot_map[rotation])
        else:
            qr_text, rotation = None, 0
            qr_engine, qr_attempts, qr_duration_ms = raw_engine, raw_attempts, raw_duration_ms
    # Keep the diagnostic useful to operators: for a landscape input, the
    # reported direction includes the initial feeder normalization. The image
    # itself has already been corrected above.
    if pre_rotation and rotation is not None:
        rotation = (pre_rotation + rotation) % 360
    return normalized, markers_found, qr_text, qr_engine, qr_attempts, qr_duration_ms, rotation

def bubble_readings(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 10)
    rows = []
    for index in range(15):
        column, row = (0, index) if index < 8 else (1, index - 8)
        base_x_mm = 9.3 if column == 0 else 108
        center_y = round((132.1 + 5.5 + row * 13) * MM)
        scores = []
        for option in range(5):
            center_x = round((base_x_mm + 37 + option * 8.5) * MM)
            radius = round(2.05 * MM)
            mask = np.zeros(gray.shape, dtype=np.uint8)
            cv2.circle(mask, (center_x, center_y), radius, 255, -1)
            scores.append(float(cv2.mean(binary, mask=mask)[0]) / 255.0)
        ordered = sorted(enumerate(scores), key=lambda item: item[1], reverse=True)
        best, best_score = ordered[0]
        second_score = ordered[1][1]
        if best_score < .25:
            answer, exception = None, 'BLANK'
        elif second_score > .16 and best_score - second_score < .09:
            answer, exception = None, 'MULTIPLE_MARKS'
        else:
            answer, exception = 'ABCDE'[best], None
        confidence = max(0.0, min(1.0, (best_score - second_score + .12) / .42)) if answer else 0.0
        rows.append({"answer": answer, "confidence": confidence, "exceptionCode": exception, "scores": scores})
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    image = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if image is None:
        print(json.dumps(fail('IMAGE_INVALID'))); return 0
    # A leitura é uma cadeia de tentativas. Uma particularidade do OpenCV em
    # uma imagem não pode encerrar o processo sem JSON nem descartar a foto.
    # Mantemos a imagem original como canônica caso a retificação falhe.
    normalization_error = None
    try:
        normalized, markers_found, qr, qr_engine, qr_attempts, qr_duration_ms, qr_rotation = normalize_page(image)
    except (cv2.error, ValueError, OverflowError):
        normalized, markers_found, qr = image, False, None
        normalization_error = 'OMR_NORMALIZATION_ERROR'
        qr_engine, qr_attempts, qr_duration_ms, qr_rotation = 'error', 0, 0, None

    if not cv2.imwrite(args.output, normalized, [cv2.IMWRITE_JPEG_QUALITY, 92]):
        # O chamador precisa de uma imagem para permitir revisão manual.
        # Esta situação é excepcional, mas ainda devolvemos JSON válido.
        print(json.dumps(fail('CANONICAL_IMAGE_WRITE_FAILED'))); return 0

    try:
        gray = cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)
        sharpness = min(1.0, cv2.Laplacian(gray, cv2.CV_64F).var() / 180.0)
    except cv2.error:
        sharpness = 0.0
        normalization_error = normalization_error or 'OMR_NORMALIZATION_ERROR'
    try:
        bubbles = bubble_readings(normalized)
    except cv2.error:
        bubbles = []
        normalization_error = normalization_error or 'OMR_BUBBLE_READ_ERROR'
    result = {
        "qrToken": qr,
        "qrFailureCode": None if qr else ("QR_CHECKSUM_FAILED" if qr_engine == "checksum_error" else "QR_NOT_FOUND"),
        "readerVersion": READER_VERSION,
        "qrEngine": qr_engine,
        "qrAttempts": qr_attempts,
        "qrDurationMs": qr_duration_ms,
        "qrRotation": qr_rotation,
        # A page cannot be considered high quality when its identity code was
        # not recovered.  The old score reached 1.0 for a sharp but unusable
        # page (and hid invalid homographies behind a perfect score).
        "qualityScore": round(
            max(0.0, min(1.0, (.25 if markers_found else .10) + .25 * sharpness + (.50 if qr else 0.0))),
            3,
        ),
        "exceptionCode": normalization_error or (None if markers_found else 'MARKERS_MISSING'),
        "bubbles": bubbles,
    }
    print(json.dumps(result))

if __name__ == '__main__':
    main()
