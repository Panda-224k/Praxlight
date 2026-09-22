import pytest
from unittest.mock import patch, MagicMock
import io
from PIL import Image
from server.ocr.scanner import OCRScanner

@patch("server.ocr.scanner.pytesseract")
def test_ocr_scanner_initialization(mock_tesseract):
    mock_tesseract.get_tesseract_version.return_value = "5.0.0"
    scanner = OCRScanner()
    assert scanner.available is True

@patch("server.ocr.scanner.pytesseract")
def test_ocr_scanner_initialization_failure(mock_tesseract):
    mock_tesseract.get_tesseract_version.side_effect = Exception("Not found")
    scanner = OCRScanner()
    assert scanner.available is False

@patch("server.ocr.scanner.pytesseract")
def test_ocr_scan_image_success(mock_tesseract):
    mock_tesseract.get_tesseract_version.return_value = "5.0.0"
    mock_tesseract.image_to_string.return_value = "Test OCR output\n"
    
    scanner = OCRScanner()
    
    # Create a dummy image byte stream
    img = Image.new('RGB', (10, 10), color = 'red')
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    
    result = scanner.scan_image(img_byte_arr.getvalue())
    assert result == "Test OCR output"

@patch("server.ocr.scanner.pytesseract")
def test_ocr_scan_unavailable(mock_tesseract):
    mock_tesseract.get_tesseract_version.side_effect = Exception("Not found")
    scanner = OCRScanner()
    
    result = scanner.scan_image(b"dummy bytes")
    assert result == ""
