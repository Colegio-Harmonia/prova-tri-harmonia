#!/usr/bin/env python3
"""Local reader for the fixed PTR1 answer sheet.

It never sends a scan outside the server.  The QR is decoded with OpenCV and
the four black corner markers rectify the page before bubble measurements.
"""
import argparse
import json
import sys
import cv2
import numpy as np

MM = 300 / 25.4
WIDTH, HEIGHT = round(210 * MM), round(297 * MM)
MARKER_CENTER = round(15.5 * MM)
TARGET = np.float32([
    [MARKER_CENTER, MARKER_CENTER],
    [WIDTH - MARKER_CENTER, MARKER_CENTER],
    [MARKER_CENTER, HEIGHT - MARKER_CENTER],
    [WIDTH - MARKER_CENTER, HEIGHT - MARKER_CENTER],
])

def fail(code):
    return {"qrToken": None, "qualityScore": 0.0, "exceptionCode": code, "bubbles": []}

def marker_centers(gray):
    _, threshold = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = gray.shape[:2]
    candidates = []
    for contour in contours:
        x, y, cw, ch = cv2.boundingRect(contour)
        area = cw * ch
        ratio = cw / max(ch, 1)
        contour_area = cv2.contourArea(contour)
        extent = contour_area / max(area, 1)
        in_corner = (x < w * .25 or x + cw > w * .75) and (y < h * .25 or y + ch > h * .75)
        if (not in_corner or area < (w * h * 0.00008) or area > (w * h * 0.015)
                or not .65 < ratio < 1.35 or extent < .55):
            continue
        candidates.append((x + cw / 2, y + ch / 2, area))
    quadrants = [(0, 0), (w, 0), (0, h), (w, h)]
    result = []
    for qx, qy in quadrants:
        result.append(min(candidates, key=lambda point: (point[0] - qx) ** 2 + (point[1] - qy) ** 2, default=None))
    if any(point is None for point in result) or len({(round(p[0]), round(p[1])) for p in result}) != 4:
        return None
    return np.float32([[p[0], p[1]] for p in result])

def rectify(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    points = marker_centers(gray)
    if points is None:
        return image, False
    matrix = cv2.getPerspectiveTransform(points, TARGET)
    return cv2.warpPerspective(image, matrix, (WIDTH, HEIGHT), borderValue=(255, 255, 255)), True

def decode_qr_robust(image):
    """Decode PTR1 QR after rotation, contrast and ROI recovery attempts.

    Scanners commonly preserve a visible QR while softening its modules or
    shifting the page.  The old code only inspected a small fixed corner ROI;
    this recovery path also tries the full page and wider corner windows.
    """
    detector = cv2.QRCodeDetector()
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    _, binary = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants = [image, clahe, binary]
    rotations = [
        (0, None),
        (90, cv2.ROTATE_90_CLOCKWISE),
        (180, cv2.ROTATE_180),
        (270, cv2.ROTATE_90_COUNTERCLOCKWISE),
    ]
    for rotation, transform in rotations:
        for variant in variants:
            candidate = cv2.rotate(variant, transform) if transform is not None else variant
            h, w = candidate.shape[:2]
            regions = [
                (int(w * .50), 0, w, int(h * .38)),
                (int(w * .58), 0, w, int(h * .30)),
            ]
            for x1, y1, x2, y2 in regions:
                crop = candidate[y1:y2, x1:x2]
                if crop.size == 0:
                    continue
                for scale in (1.0, 1.5, 2.0, 3.0):
                    resized = cv2.resize(crop, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                    try:
                        val, _, _ = detector.detectAndDecode(resized)
                    except cv2.error:
                        # Um candidato ruim não pode abortar a página inteira.
                        continue
                    if not val and hasattr(detector, 'detectAndDecodeCurved'):
                        try:
                            val, _, _ = detector.detectAndDecodeCurved(resized)
                        except cv2.error:
                            # detectAndDecodeCurved pode lançar floodFill em
                            # alguns recortes; siga para a próxima tentativa.
                            val = None
                    if val and val.startswith('PTR1.'):
                        return val, rotation
    return None, 0

def normalize_page(image):
    qr_text, rotation = decode_qr_robust(image)
    if rotation != 0:
        rot_map = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
        image = cv2.rotate(image, rot_map[rotation])
    normalized, markers_found = rectify(image)
    if qr_text is None:
        qr_text, _ = decode_qr_robust(normalized)
    return normalized, markers_found, qr_text

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
        normalized, markers_found, qr = normalize_page(image)
    except (cv2.error, ValueError, OverflowError):
        normalized, markers_found, qr = image, False, None
        normalization_error = 'OMR_NORMALIZATION_ERROR'

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
        "qualityScore": round((.55 if markers_found else .2) + .45 * sharpness, 3),
        "exceptionCode": normalization_error or (None if markers_found else 'MARKERS_MISSING'),
        "bubbles": bubbles,
    }
    print(json.dumps(result))

if __name__ == '__main__':
    main()
