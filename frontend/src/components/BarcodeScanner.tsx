import { useEffect, useState, useRef, useCallback } from 'react';
import { Camera, CameraOff, CheckCircle2, XCircle, Loader2, ScanLine } from 'lucide-react';

interface ScanResult {
  success: boolean;
  message: string;
}

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  isProcessing: boolean;
  lastResult?: ScanResult | null;
}

// Declare BarcodeDetector for TypeScript
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => {
      detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string; format: string }>>;
    };
  }
}

export function BarcodeScanner({
  onScan,
  isProcessing,
  lastResult,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState(false);
  const lastScanTimeRef = useRef<number>(0);
  const lastScanCodeRef = useRef<string | null>(null);
  const animationRef = useRef<number | null>(null);
  const detectorRef = useRef<InstanceType<NonNullable<typeof window.BarcodeDetector>> | null>(null);

  const handleDetection = useCallback((rawValue: string) => {
    const now = Date.now();

    // Debounce same barcode within 3 seconds
    if (
      rawValue === lastScanCodeRef.current &&
      now - lastScanTimeRef.current < 3000
    ) {
      return;
    }

    lastScanTimeRef.current = now;
    lastScanCodeRef.current = rawValue;

    // Trigger flash effect
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 400);

    // Call parent handler
    onScan(rawValue);
  }, [onScan]);

  useEffect(() => {
    let mounted = true;
    let stream: MediaStream | null = null;

    const startScanning = async () => {
      try {
        // Check if BarcodeDetector is available
        if (!window.BarcodeDetector) {
          setError('BarcodeDetector not supported. Try Chrome or Edge.');
          return;
        }

        // Create detector with all common formats
        detectorRef.current = new window.BarcodeDetector({
          formats: [
            'code_128',
            'code_39',
            'code_93',
            'codabar',
            'ean_13',
            'ean_8',
            'upc_a',
            'upc_e',
            'itf',
            'qr_code',
            'data_matrix',
            'aztec',
            'pdf417',
          ],
        });

        // Get camera stream
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (!mounted || !videoRef.current) return;

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        setIsScanning(true);
        setError(null);

        // Start scanning loop
        const scanLoop = async () => {
          if (!mounted || !videoRef.current || !detectorRef.current) return;

          try {
            const barcodes = await detectorRef.current.detect(videoRef.current);

            if (barcodes.length > 0) {
              console.log('Detected:', barcodes[0]);
              handleDetection(barcodes[0].rawValue);
            }
          } catch (err) {
            // Ignore detection errors
          }

          if (mounted) {
            animationRef.current = requestAnimationFrame(scanLoop);
          }
        };

        scanLoop();
      } catch (err) {
        console.error('Scanner error:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to start camera');
        }
      }
    };

    startScanning();

    return () => {
      mounted = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [handleDetection]);

  return (
    <div className="flex flex-col items-center">
      {/* Camera viewport */}
      <div className="relative w-full max-w-lg">
        {/* Video element for camera feed */}
        <video
          ref={videoRef}
          className="w-full rounded-lg bg-black"
          style={{ minHeight: '350px' }}
          playsInline
          muted
        />

        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Scanning overlay */}
        {isScanning && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative w-72 h-36 border-2 border-green-400 rounded-lg">
              {/* Animated scan line */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-green-400 animate-pulse" />
            </div>
          </div>
        )}

        {/* Flash effect on successful scan */}
        {showFlash && (
          <div className="absolute inset-0 bg-green-400/40 rounded-lg pointer-events-none z-50 flex items-center justify-center">
            <div className="px-6 py-3 bg-green-500 text-white rounded-full text-lg font-semibold shadow-xl flex items-center gap-2 animate-bounce">
              <ScanLine className="h-5 w-5" />
              Captured!
            </div>
          </div>
        )}
      </div>

      {/* Status indicator */}
      <div className="mt-4 flex items-center gap-2">
        {isScanning ? (
          <>
            <Camera className="h-5 w-5 text-green-500 animate-pulse" />
            <span className="text-green-600">Camera active - point at barcode</span>
          </>
        ) : (
          <>
            <CameraOff className="h-5 w-5 text-gray-400" />
            <span className="text-gray-500">Starting camera...</span>
          </>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-red-600 text-sm">{error}</span>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
          <span className="text-blue-600">Processing scan...</span>
        </div>
      )}

      {/* Last scan result */}
      {lastResult && !isProcessing && (
        <div
          className={`mt-4 px-6 py-3 rounded-lg flex items-center gap-2 transition-all ${
            lastResult.success
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          {lastResult.success ? (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500 shrink-0" />
          )}
          <span
            className={lastResult.success ? 'text-green-700' : 'text-red-700'}
          >
            {lastResult.message}
          </span>
        </div>
      )}
    </div>
  );
}
