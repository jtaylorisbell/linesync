import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  CameraOff,
  Loader2,
  Check,
  X,
  AlertCircle,
  Trash2,
  Plus,
  RotateCcw,
  Aperture,
  Sparkles,
  PackageCheck,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { ParsedLineItem, BulkIntakeItem } from '../types/api';

interface EditableItem extends ParsedLineItem {
  id: string;
}

interface PackingSlipUploadProps {
  onComplete?: () => void;
}

export function PackingSlipUpload({ onComplete }: PackingSlipUploadProps) {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<EditableItem[]>([]);
  const [metadata, setMetadata] = useState<{
    vendor: string | null;
    po_number: string | null;
    ship_date: string | null;
    notes: string | null;
  } | null>(null);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Animation states
  const [showParseSuccess, setShowParseSuccess] = useState(false);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);
  const [parsedItemCount, setParsedItemCount] = useState(0);
  const [submittedData, setSubmittedData] = useState<{ items: number; qty: number } | null>(null);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error('Camera error:', err);
      setCameraError(
        err instanceof Error ? err.message : 'Failed to access camera'
      );
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  // Initialize camera on mount
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // Parse mutation
  const parseMutation = useMutation({
    mutationFn: async (imageDataUrl: string) => {
      // Convert data URL to blob
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      const file = new File([blob], 'packing-slip.jpg', { type: 'image/jpeg' });
      return api.parsePackingSlip(file);
    },
    onSuccess: (data) => {
      const items = data.items.map((item, index) => ({
        ...item,
        id: `item-${index}-${Date.now()}`,
      }));
      setParsedItems(items);
      setMetadata({
        vendor: data.vendor,
        po_number: data.po_number,
        ship_date: data.ship_date,
        notes: data.notes,
      });

      // Trigger parse success animation
      if (items.length > 0) {
        setParsedItemCount(items.length);
        setShowParseSuccess(true);
        setTimeout(() => setShowParseSuccess(false), 2000);
      }
    },
  });

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: (items: BulkIntakeItem[]) =>
      api.createBulkIntake({ station_id: 'PACKING_SLIP', items }),
    onSuccess: (data) => {
      // Trigger submit success animation
      setSubmittedData({ items: data.total_items, qty: data.total_qty });
      setShowSubmitSuccess(true);

      // After animation, reset to camera mode
      setTimeout(() => {
        setShowSubmitSuccess(false);
        setSubmittedData(null);
        setSubmitResult({
          success: true,
          message: `Successfully received ${data.total_items} items (${data.total_qty} total units)`,
        });
        handleRetake();
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        queryClient.invalidateQueries({ queryKey: ['events'] });
        onComplete?.();
      }, 2500);
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to submit intake';
      setSubmitResult({ success: false, message });
    },
  });

  // Capture photo from video
  const handleCapture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current video frame
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      setCapturedImage(imageDataUrl);
      stopCamera();

      // Automatically start parsing
      parseMutation.mutate(imageDataUrl);
    }
  }, [stopCamera, parseMutation]);

  // Retake photo
  const handleRetake = useCallback(() => {
    setCapturedImage(null);
    setParsedItems([]);
    setMetadata(null);
    setSubmitResult(null);
    parseMutation.reset();
    startCamera();
  }, [startCamera, parseMutation]);

  const handleItemChange = (
    id: string,
    field: 'item_id' | 'qty',
    value: string | number
  ) => {
    setParsedItems((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, [field]: field === 'qty' ? Number(value) : value }
          : item
      )
    );
  };

  const handleRemoveItem = (id: string) => {
    setParsedItems((items) => items.filter((item) => item.id !== id));
  };

  const handleAddItem = () => {
    setParsedItems((items) => [
      ...items,
      {
        id: `item-new-${Date.now()}`,
        item_id: '',
        qty: 1,
        description: null,
        confidence: 'high',
      },
    ]);
  };

  const handleSubmit = () => {
    const validItems = parsedItems.filter(
      (item) => item.item_id.trim() && item.qty > 0
    );
    if (validItems.length === 0) {
      setSubmitResult({ success: false, message: 'No valid items to submit' });
      return;
    }
    submitMutation.mutate(
      validItems.map((item) => ({ item_id: item.item_id, qty: item.qty }))
    );
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">
            High
          </span>
        );
      case 'medium':
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-700">
            Medium
          </span>
        );
      case 'low':
        return (
          <span className="px-1.5 py-0.5 text-xs rounded bg-red-100 text-red-700">
            Low
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Camera / Captured Image View */}
      <div className="relative w-full max-w-2xl mx-auto">
        {!capturedImage ? (
          <>
            {/* Live camera feed */}
            <video
              ref={videoRef}
              className="w-full rounded-lg bg-black"
              style={{ minHeight: '400px' }}
              playsInline
              muted
            />

            {/* Camera overlay */}
            {isCameraActive && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner guides */}
                <div className="absolute top-4 left-4 w-12 h-12 border-l-4 border-t-4 border-white/70 rounded-tl-lg" />
                <div className="absolute top-4 right-4 w-12 h-12 border-r-4 border-t-4 border-white/70 rounded-tr-lg" />
                <div className="absolute bottom-4 left-4 w-12 h-12 border-l-4 border-b-4 border-white/70 rounded-bl-lg" />
                <div className="absolute bottom-4 right-4 w-12 h-12 border-r-4 border-b-4 border-white/70 rounded-br-lg" />
              </div>
            )}

            {/* Capture button */}
            {isCameraActive && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                <button
                  onClick={handleCapture}
                  className="p-4 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors"
                  title="Capture"
                >
                  <Aperture className="h-8 w-8 text-gray-800" />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Captured image */}
            <img
              src={capturedImage}
              alt="Captured packing slip"
              className="w-full rounded-lg"
            />

            {/* Parsing overlay */}
            {parseMutation.isPending && (
              <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                <div className="bg-white px-6 py-4 rounded-lg flex items-center gap-3">
                  <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                  <span className="text-gray-700 font-medium">
                    Analyzing with AI...
                  </span>
                </div>
              </div>
            )}

            {/* Parse success animation */}
            {showParseSuccess && (
              <div className="absolute inset-0 bg-green-500/80 rounded-lg flex items-center justify-center animate-pulse pointer-events-none">
                <div className="bg-white px-8 py-6 rounded-xl shadow-2xl flex flex-col items-center gap-3 animate-bounce">
                  <div className="relative">
                    <Sparkles className="h-12 w-12 text-green-500" />
                    <div className="absolute -top-1 -right-1 bg-green-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                      {parsedItemCount}
                    </div>
                  </div>
                  <span className="text-green-700 font-bold text-lg">
                    {parsedItemCount} Items Found!
                  </span>
                </div>
              </div>
            )}

            {/* Retake button */}
            <button
              onClick={handleRetake}
              className="absolute top-4 right-4 p-2 bg-white/90 rounded-lg shadow hover:bg-white transition-colors"
              title="Retake"
            >
              <RotateCcw className="h-5 w-5 text-gray-700" />
            </button>
          </>
        )}

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Camera status */}
      {!capturedImage && (
        <div className="flex items-center justify-center gap-2">
          {isCameraActive ? (
            <>
              <Camera className="h-5 w-5 text-green-500" />
              <span className="text-green-600">
                Position packing slip in frame and tap capture
              </span>
            </>
          ) : cameraError ? (
            <>
              <CameraOff className="h-5 w-5 text-red-500" />
              <span className="text-red-600">{cameraError}</span>
            </>
          ) : (
            <>
              <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
              <span className="text-gray-500">Starting camera...</span>
            </>
          )}
        </div>
      )}

      {/* Parse Error */}
      {parseMutation.isError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">
              Failed to parse packing slip
            </p>
            <p className="text-sm text-red-600 mt-1">
              {parseMutation.error instanceof ApiError
                ? parseMutation.error.message
                : 'An error occurred. Try capturing a clearer image.'}
            </p>
          </div>
        </div>
      )}

      {/* Metadata */}
      {metadata &&
        (metadata.vendor || metadata.po_number || metadata.ship_date) && (
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Document Info
            </h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              {metadata.vendor && (
                <div>
                  <span className="text-gray-500">Vendor:</span>{' '}
                  <span className="font-medium">{metadata.vendor}</span>
                </div>
              )}
              {metadata.po_number && (
                <div>
                  <span className="text-gray-500">PO #:</span>{' '}
                  <span className="font-medium">{metadata.po_number}</span>
                </div>
              )}
              {metadata.ship_date && (
                <div>
                  <span className="text-gray-500">Ship Date:</span>{' '}
                  <span className="font-medium">{metadata.ship_date}</span>
                </div>
              )}
            </div>
            {metadata.notes && (
              <p className="text-sm text-amber-600 mt-2 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {metadata.notes}
              </p>
            )}
          </div>
        )}

      {/* Parsed Items Form */}
      {parsedItems.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h4 className="text-sm font-medium text-gray-700">
              Review Items ({parsedItems.length})
            </h4>
            <p className="text-xs text-gray-500 mt-1">
              Edit or remove items before submitting
            </p>
          </div>

          <div className="divide-y divide-gray-100">
            {parsedItems.map((item) => (
              <div key={item.id} className="p-4 flex items-center gap-4">
                <div className="flex-1 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-5">
                    <label className="text-xs text-gray-500 block mb-1">
                      Item ID
                    </label>
                    <input
                      type="text"
                      value={item.item_id}
                      onChange={(e) =>
                        handleItemChange(item.id, 'item_id', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Part number"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">
                      Qty
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={item.qty}
                      onChange={(e) =>
                        handleItemChange(item.id, 'qty', e.target.value)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-4">
                    {item.description && (
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">
                          Description
                        </label>
                        <p className="text-sm text-gray-600 truncate">
                          {item.description}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="col-span-1 flex items-center justify-end">
                    {getConfidenceBadge(item.confidence)}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                  title="Remove item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={handleAddItem}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Plus className="h-4 w-4" />
              Add item
            </button>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                Total: {parsedItems.reduce((sum, item) => sum + item.qty, 0)}{' '}
                units
              </span>
              <button
                onClick={handleSubmit}
                disabled={submitMutation.isPending || parsedItems.length === 0}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Submit Intake
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Result */}
      {submitResult && (
        <div
          className={`p-4 rounded-lg flex items-start gap-3 ${
            submitResult.success
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          {submitResult.success ? (
            <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
          ) : (
            <X className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          )}
          <p
            className={`text-sm font-medium ${
              submitResult.success ? 'text-green-800' : 'text-red-800'
            }`}
          >
            {submitResult.message}
          </p>
        </div>
      )}

      {/* Full-screen submit success animation */}
      {showSubmitSuccess && submittedData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 transform transition-all duration-300"
            style={{ animation: 'bounceIn 0.5s ease-out' }}
          >
            <style>{`
              @keyframes bounceIn {
                0% { transform: scale(0.3); opacity: 0; }
                50% { transform: scale(1.05); }
                70% { transform: scale(0.95); }
                100% { transform: scale(1); opacity: 1; }
              }
            `}</style>
            <div className="relative">
              <div className="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-25" />
              <div className="relative bg-green-500 rounded-full p-4">
                <PackageCheck className="h-16 w-16 text-white" />
              </div>
            </div>
            <h3 className="text-2xl font-bold text-gray-900">
              Inventory Updated!
            </h3>
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-3xl font-bold text-green-600">{submittedData.items}</p>
                <p className="text-sm text-gray-500">Items</p>
              </div>
              <div className="w-px bg-gray-200" />
              <div>
                <p className="text-3xl font-bold text-green-600">{submittedData.qty}</p>
                <p className="text-sm text-gray-500">Total Units</p>
              </div>
            </div>
            <p className="text-gray-500 text-sm mt-2 animate-pulse">
              Returning to camera...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
