// MediaPipe Face Landmarker の読み込み（最初の測定のときだけ読む。ライブラリとモデルは同梱）
let pending = null;
let cpuFallback = false;

async function create(delegate) {
  const vision = await import('../vendor/mediapipe/vision_bundle.mjs');
  const wasmBase = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
  const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
  return vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('../models/face_landmarker.task', import.meta.url).href, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export function loadLandmarker() {
  if (!pending) {
    pending = (async () => {
      if (!cpuFallback) {
        try { return await create('GPU'); } catch (e) { cpuFallback = true; }
      }
      return create('CPU');
    })().catch((e) => { pending = null; throw e; });
  }
  return pending;
}

// GPU で検出に失敗したときに CPU で作り直す
export async function reloadOnCpu() {
  if (cpuFallback) return null;
  cpuFallback = true;
  try { (await pending)?.close(); } catch (e) { /* 閉じられなくても続ける */ }
  pending = null;
  return loadLandmarker();
}
