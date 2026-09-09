import unittest

import cv2
import numpy as np

import read_ptr1 as reader


class Ptr1ReaderTest(unittest.TestCase):
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
            normalized, found, decoded = reader.normalize_page(orientation)
            answers = [item["answer"] for item in reader.bubble_readings(normalized)[:len(expected)]]
            self.assertTrue(found)
            self.assertEqual(decoded, token)
            self.assertEqual(answers, list(expected))


if __name__ == "__main__":
    unittest.main()
