import logging
import pytesseract
from PIL import Image
import io
import os

log = logging.getLogger("praxsight.ocr")

class OCRScanner:
    def __init__(self):
        # Allow overriding the tesseract path via environment variable (useful on Windows)
        # Default typical Windows path: r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        tesseract_cmd = os.getenv("TESSERACT_CMD")
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
            
        self.available = True
        try:
            # Simple check if tesseract is in PATH or valid
            pytesseract.get_tesseract_version()
            log.info("OCR Scanner initialized (Tesseract available).")
        except Exception as e:
            self.available = False
            log.warning("OCR Scanner unavailable (Tesseract not found). Install tesseract-ocr to enable physical document scanning. Details: %s", e)

    def scan_image(self, image_bytes: bytes) -> str:
        """
        Extracts raw text from an image.
        Returns empty string if OCR fails or is unavailable.
        """
        if not self.available:
            return ""
            
        try:
            image = Image.open(io.BytesIO(image_bytes))
            # Convert to RGB if necessary
            if image.mode != "RGB":
                image = image.convert("RGB")
                
            raw_text = pytesseract.image_to_string(image)
            return raw_text.strip()
        except Exception as e:
            log.error(f"OCR scan failed: {e}")
            return ""

# Singleton instance
scanner = OCRScanner()
