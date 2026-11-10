"""Regressão com PDFs do gerador real, habilitada por SHEET_LAYOUT_PDF_DIR."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest

import cv2
import numpy as np

import read_ptr1 as reader


@unittest.skipUnless(os.environ.get('SHEET_LAYOUT_PDF_DIR'), 'SHEET_LAYOUT_PDF_DIR não configurado')
class SheetPdfCompatibilityTest(unittest.TestCase):
    def test_generated_pdfs_preserve_identity_and_answers_in_both_readers(self):
        import fitz
        worker_path = Path(__file__).resolve().parents[1] / 'scan-worker/app/main.py'
        spec = importlib.util.spec_from_file_location('scan_worker_regression', worker_path)
        worker = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = worker
        spec.loader.exec_module(worker)
        expected = list('EBCDABCDABCDA') + [None, None]
        questions = [worker.DispatchQuestion(number=index + 1, alternatives=4 if index % 2 else 5)
                     for index in range(15)]
        for layout, first, gap in [('PTR1', 137.6, 13), ('PTR2', 141, 9), ('PTR3', 102, 9)]:
            pdf = fitz.open(Path(os.environ['SHEET_LAYOUT_PDF_DIR']) / f'scan-regression-{layout}.pdf')
            for page_number, page in enumerate(pdf, 1):
                text = page.get_text()
                self.assertIn('ID DA PROVA: #123', text)
                if layout == 'PTR3':
                    self.assertEqual(text.count('Estudante de teste'), 1)
                    self.assertNotIn('Aluno:', text)
                pixmap = page.get_pixmap(dpi=200, colorspace=fitz.csRGB)
                image = cv2.cvtColor(np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3), cv2.COLOR_RGB2BGR)
                _, _, token, *_ = reader.normalize_page(image)
                self.assertEqual(reader.layout_from_qr(token), layout)
                self.assertEqual(token.split('.')[2], str(page_number))
            for dpi in (150, 200, 300):
                with self.subTest(layout=layout, dpi=dpi):
                    pixmap = pdf[0].get_pixmap(dpi=dpi, colorspace=fitz.csRGB)
                    image = cv2.cvtColor(np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3), cv2.COLOR_RGB2BGR)
                    # Preenche 13 respostas, deixa uma em branco e marca duas na última.
                    scale = dpi / 25.4
                    for index in range(15):
                        column, row = (0, index) if index < 8 else (1, index - 8)
                        options = ['ABCDE'.index(expected[index])] if index < 13 else [] if index == 13 else [0, 1]
                        for option in options:
                            x = (46.3 if column == 0 else 145) + option * 8.5
                            cv2.circle(image, (round(x * scale), round((first + row * gap) * scale)),
                                       round(2.1 * scale), (0, 0, 0), -1)
                    # Simula inclinação do alimentador antes de girar a folha.
                    h, w = image.shape[:2]
                    source = np.float32([[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]])
                    target = source + np.float32([[12, 8], [-8, 2], [4, -6], [-12, -9]])
                    image = cv2.warpPerspective(image, cv2.getPerspectiveTransform(source, target), (w, h), borderValue=(255, 255, 255))
                    for rotation in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE):
                        scan = image if rotation is None else cv2.rotate(image, rotation)
                        normalized, found, token, *_ = reader.normalize_page(scan)
                        self.assertTrue(found)
                        self.assertEqual(reader.layout_from_qr(token), layout)
                        readings = reader.bubble_readings(normalized, reader.layout_from_qr(token))
                        self.assertEqual([row['answer'] for row in readings], expected)
                        self.assertEqual(readings[13]['exceptionCode'], 'BLANK')
                        self.assertEqual(readings[14]['exceptionCode'], 'MULTIPLE_MARKS')
                        # O worker n8n usa outra resolução, mas a mesma geometria física.
                        canonical = cv2.resize(normalized, (worker.CANONICAL_WIDTH, worker.CANONICAL_HEIGHT))
                        remote = worker.objective_readings(canonical, questions, layout)
                        self.assertEqual([row['suggestedLetter'] for row in remote], expected)
                        crop = worker.objective_crop(canonical, questions, 15, layout)
                        self.assertEqual(crop.shape[0], 110 if layout == 'PTR1' else 80)


if __name__ == '__main__':
    unittest.main()
