import { useEffect, useState, useRef, useCallback } from 'react';
import { Camera, CameraOff, CheckCircle2, XCircle, Loader2, Zap } from 'lucide-react';

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
      <div className="relative w-full">
        {/* Video element for camera feed */}
        <video
          ref={videoRef}
          className="w-full rounded-xl bg-black border-2 border-[var(--border-primary)]"
          style={{ minHeight: '320px' }}
          playsInline
          muted
        />

        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Scanning overlay */}
        {isScanning && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Scan frame */}
            <div className="relative w-72 h-36">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-[var(--accent-primary)] rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[var(--accent-primary)] rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-[var(--accent-primary)] rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-[var(--accent-primary)] rounded-br-lg" />

              {/* Animated scan line */}
              <div className="scan-line" />
            </div>
          </div>
        )}

        {/* Flash effect on successful scan */}
        {showFlash && (
          <div className="absolute inset-0 bg-[var(--accent-primary)]/30 rounded-xl pointer-events-none z-50 flex items-center justify-center glow-cyan">
            <div className="px-6 py-3 bg-[var(--accent-primary)] text-[var(--bg-primary)] rounded-full text-lg font-bold shadow-xl flex items-center gap-2 animate-bounce">
              <Zap className="h-5 w-5" />
              Scanned!
            </div>
          </div>
        )}
      </div>

      {/* Status indicator */}
      <div className="mt-4 flex items-center gap-2">
        {isScanning ? (
          <>
            <div className="relative">
              <Camera className="h-5 w-5 text-[var(--accent-success)]" />
              <div className="absolute inset-0 animate-ping">
                <Camera className="h-5 w-5 text-[var(--accent-success)]" />
              </div>
            </div>
            <span className="text-[var(--accent-success)]">Camera active — point at barcode</span>
          </>
        ) : (
          <>
            <CameraOff className="h-5 w-5 text-[var(--text-muted)]" />
            <span className="text-[var(--text-muted)]">Starting camera...</span>
          </>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-3 px-4 py-2 bg-[var(--accent-danger-dim)] border border-[var(--accent-danger)] rounded-xl">
          <span className="text-[var(--accent-danger)] text-sm">{error}</span>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="mt-4 flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary-dim)] border border-[var(--accent-primary)] rounded-xl">
          <Loader2 className="h-5 w-5 text-[var(--accent-primary)] animate-spin" />
          <span className="text-[var(--accent-primary)]">Processing...</span>
        </div>
      )}

      {/* Last scan result */}
      {lastResult && !isProcessing && (
        <div
          className={`mt-4 px-6 py-3 rounded-xl flex items-center gap-3 transition-all animate-slide-in ${
            lastResult.success
              ? 'bg-[var(--accent-success-dim)] border border-[var(--accent-success)]'
              : 'bg-[var(--accent-danger-dim)] border border-[var(--accent-danger)]'
          }`}
        >
          {lastResult.success ? (
            <CheckCircle2 className="h-5 w-5 text-[var(--accent-success)] shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-[var(--accent-danger)] shrink-0" />
          )}
          <span
            className={lastResult.success ? 'text-[var(--accent-success)]' : 'text-[var(--accent-danger)]'}
          >
            {lastResult.message}
          </span>
        </div>
      )}
    </div>
  );
}
