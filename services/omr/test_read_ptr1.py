import os
import unittest
from unittest.mock import patch

import cv2
import numpy as np

import read_ptr1 as reader


class Ptr1ReaderTest(unittest.TestCase):
    def test_rejects_missing_corner_instead_of_using_qr_as_marker(self):
        page = np.full((reader.HEIGHT, reader.WIDTH, 3), 255, dtype=np.uint8)
        half_marker = round(3.5 * reader.MM)
        for index, (x, y) in enumerate(reader.TARGET.astype(int)):
            if index == 0:
                continue
            cv2.rectangle(page, (x - half_marker, y - half_marker),
                          (x + half_marker, y + half_marker), (0, 0, 0), -1)

        # This square is deliberately in the QR area.  It must not be
        # promoted to the absent upper-left fiducial.
        cv2.rectangle(page, (round(reader.WIDTH * .78), round(reader.HEIGHT * .12)),
                      (round(reader.WIDTH * .86), round(reader.HEIGHT * .20)), (0, 0, 0), -1)
        normalized, found = reader.rectify(page)
        self.assertFalse(found)
        self.assertTrue(np.array_equal(normalized, page))

    def test_accepts_native_qr_before_rectification(self):
        page = np.full((reader.HEIGHT, reader.WIDTH, 3), 255, dtype=np.uint8)
        token = "PTR1.synthetic.native.1"
        with patch.object(reader, "decode_qr_robust", return_value=(token, 0, "zxing", 1, 2)):
            normalized, found, decoded, engine, attempts, duration_ms, rotation = reader.normalize_page(page)
        self.assertEqual(decoded, token)
        self.assertEqual(engine, "zxing")
        self.assertTrue(found is False)
        self.assertEqual(attempts, 1)
        self.assertEqual(duration_ms, 2)
        self.assertEqual(rotation, 0)
        self.assertTrue(np.array_equal(normalized, page))

    def test_rectifies_marker_with_a_broken_gray_border(self):
        page = np.full((reader.HEIGHT, reader.WIDTH, 3), 255, dtype=np.uint8)
        half_marker = round(3.5 * reader.MM)
        for x, y in reader.TARGET.astype(int):
            cv2.rectangle(page, (x - half_marker, y - half_marker),
                          (x + half_marker, y + half_marker), (135, 135, 135), -1)

        # A scanner seam or white page border can break one gray fiducial into
        # two contours. The close in marker_centers must reunite it.
        x, y = reader.TARGET.astype(int)[3]
        cv2.line(page, (x - half_marker, y), (x + half_marker, y),
                 (255, 255, 255), 1)

        _normalized, found = reader.rectify(page)
        self.assertTrue(found)

    def test_rectifies_light_scanner_markers_and_reads_filled_bubbles(self):
        page = np.full((reader.HEIGHT, reader.WIDTH, 3), 255, dtype=np.uint8)
        half_marker = round(3.5 * reader.MM)
        for x, y in reader.TARGET.astype(int):
            cv2.rectangle(page, (x - half_marker, y - half_marker),
                          (x + half_marker, y + half_marker), (135, 135, 135), -1)

        expected = "CACAA CA".replace(" ", "")
        for index, letter in enumerate(expected):
            column, row = (0, index) if index < 8 else (1, index - 8)
            base_x_mm = 9.3 if column == 0 else 108
            center_y = round((137.6 + row * 13) * reader.MM)
            option = "ABCDE".index(letter)
            center_x = round((base_x_mm + 37 + option * 8.5) * reader.MM)
            cv2.circle(page, (center_x, center_y), round(2.05 * reader.MM), (35, 35, 35), -1)

        token = "PTR1.synthetic.1.PTR1.test.signature"
        qr = cv2.QRCodeEncoder_create().encode(token)
        qr = cv2.resize(qr, (360, 360), interpolation=cv2.INTER_NEAREST)
        page[420:780, 1980:2340] = cv2.cvtColor(qr, cv2.COLOR_GRAY2BGR)

        # Simula uma alimentação levemente torta no scanner.
        source = np.float32([[0, 0], [reader.WIDTH - 1, 0], [0, reader.HEIGHT - 1],
                             [reader.WIDTH - 1, reader.HEIGHT - 1]])
        destination = np.float32([[35, 18], [reader.WIDTH - 22, 5], [12, reader.HEIGHT - 15],
                                  [reader.WIDTH - 40, reader.HEIGHT - 28]])
        scan = cv2.warpPerspective(page, cv2.getPerspectiveTransform(source, destination),
                                   (reader.WIDTH, reader.HEIGHT), borderValue=(255, 255, 255))

        orientations = [
            scan,
            cv2.rotate(scan, cv2.ROTATE_90_CLOCKWISE),
            cv2.rotate(scan, cv2.ROTATE_180),
            cv2.rotate(scan, cv2.ROTATE_90_COUNTERCLOCKWISE),
        ]
        for orientation in orientations:
            normalized, found, decoded, _engine, _attempts, _duration_ms, _rotation = reader.normalize_page(orientation)
            answers = [item["answer"] for item in reader.bubble_readings(normalized)[:len(expected)]]
            self.assertTrue(found)
            self.assertEqual(decoded, token)
            self.assertEqual(answers, list(expected))

    def test_known_real_scan_when_fixture_is_available(self):
        fixture = os.environ.get('PTR1_REGRESSION_IMAGE')
        if not fixture:
            self.skipTest('PTR1_REGRESSION_IMAGE não configurado')
        image = cv2.imread(fixture, cv2.IMREAD_COLOR)
        self.assertIsNotNone(image)
        normalized, _found, decoded, engine, attempts, duration_ms, rotation = reader.normalize_page(image)
        self.assertEqual(decoded, 'PTR1.DE-BVl_UJiWdYnR1zymR3_Jd.2.PTR1.jul-2026.I2ufKOpEaFhYfr_d6GhTItEYZVFOigXmcDKmhH5OwyQ')
        self.assertEqual(engine, 'zxing')
        self.assertGreater(attempts, 0)
        self.assertLess(duration_ms, 8_000)
        self.assertIn(rotation, (0, 90, 180, 270))

    def test_known_second_real_scan_when_fixture_is_available(self):
        fixture = os.environ.get('PTR1_REGRESSION_IMAGE_1972')
        if not fixture:
            self.skipTest('PTR1_REGRESSION_IMAGE_1972 não configurado')
        image = cv2.imread(fixture, cv2.IMREAD_COLOR)
        self.assertIsNotNone(image)
        normalized, found, decoded, engine, attempts, duration_ms, rotation = reader.normalize_page(image)
        self.assertTrue(found)
        self.assertEqual(decoded, 'PTR1.kZ658zRrhVPtGKJVRRSGsiKC.3.PTR1.jul-2026.38CygzuLKfPIhFCxwbD89KlOn3K3DLhPTuNArD4CbU4')
        self.assertEqual(engine, 'zxing')
        self.assertGreater(attempts, 0)
        self.assertLess(duration_ms, 8_000)
        self.assertIn(rotation, (0, 90, 180, 270))
        normalized_qr, normalized_rotation, _, _, _ = reader.decode_qr_robust(normalized)
        self.assertEqual(normalized_qr, decoded)
        self.assertEqual(normalized_rotation, 0)

    def test_known_timeout_scan_is_bounded_and_decodes_when_fixture_is_available(self):
        fixture = os.environ.get('PTR1_REGRESSION_IMAGE_2612')
        if not fixture:
            self.skipTest('PTR1_REGRESSION_IMAGE_2612 não configurado')
        image = cv2.imread(fixture, cv2.IMREAD_COLOR)
        self.assertIsNotNone(image)
        normalized, found, decoded, engine, attempts, duration_ms, rotation = reader.normalize_page(image)
        self.assertTrue(found)
        self.assertEqual(decoded, 'PTR1.FaKeac_gL4kddbp0ONpMvgjB.3.PTR1.jul-2026.EOSf8_U8sy9Rv7TuqPFmjvHWxAkZik8lH_LDduccp9I')
        self.assertEqual(engine, 'zxing')
        self.assertGreater(attempts, 0)
        self.assertLess(duration_ms, reader.QR_DECODE_BUDGET_MS)
        self.assertEqual(rotation, 180)

    def test_known_checksum_scan_recovers_from_speckle_when_fixture_is_available(self):
        fixture = os.environ.get('PTR1_REGRESSION_IMAGE_2640')
        if not fixture:
            self.skipTest('PTR1_REGRESSION_IMAGE_2640 não configurado')
        image = cv2.imread(fixture, cv2.IMREAD_COLOR)
        self.assertIsNotNone(image)
        normalized, found, decoded, engine, attempts, duration_ms, rotation = reader.normalize_page(image)
        self.assertTrue(found)
        self.assertEqual(decoded, 'PTR1.CuMJpytXU4F59TDIMG6XOv5d.2.PTR1.jul-2026.LZua3V98jiUYqUtf4Q-nIoWpRXQmHZAD0ydEzdZaYjs')
        self.assertEqual(engine, 'zxing')
        self.assertGreater(attempts, 0)
        self.assertLess(duration_ms, reader.QR_DECODE_BUDGET_MS)
        self.assertEqual(rotation, 180)


if __name__ == "__main__":
    unittest.main()
