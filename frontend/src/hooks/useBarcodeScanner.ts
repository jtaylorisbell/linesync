import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface UseBarcodeScanner {
  isScanning: boolean;
  lastScannedCode: string | null;
  error: string | null;
  startScanning: () => Promise<void>;
  stopScanning: () => Promise<void>;
}

export function useBarcodeScanner(
  elementId: string,
  onScan: (code: string) => void,
  debounceMs: number = 3000
): UseBarcodeScanner {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const lastScanCodeRef = useRef<string | null>(null);

  const handleScan = useCallback(
    (decodedText: string) => {
      const now = Date.now();

      // Debounce same barcode within the debounce window
      if (
        decodedText === lastScanCodeRef.current &&
        now - lastScanTimeRef.current < debounceMs
      ) {
        return;
      }

      lastScanTimeRef.current = now;
      lastScanCodeRef.current = decodedText;
      setLastScannedCode(decodedText);
      onScan(decodedText);
    },
    [onScan, debounceMs]
  );

  const startScanning = useCallback(async () => {
    try {
      setError(null);

      // Create new scanner instance with supported formats
      const scanner = new Html5Qrcode(elementId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            // Use 80% of the viewfinder size for the scan region
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrboxSize = Math.floor(minEdge * 0.8);
            return {
              width: Math.min(qrboxSize, 300),
              height: Math.min(Math.floor(qrboxSize * 0.5), 150),
            };
          },
          aspectRatio: 4 / 3,
          disableFlip: false,
        },
        handleScan,
        () => {
          // Ignore scan errors (no barcode detected)
        }
      );

      setIsScanning(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start camera';
      setError(message);
      console.error('Scanner start error:', err);
    }
  }, [elementId, handleScan]);

  const stopScanning = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch (err) {
        console.error('Scanner stop error:', err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  return {
    isScanning,
    lastScannedCode,
    error,
    startScanning,
    stopScanning,
  };
}
