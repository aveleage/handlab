// 映像の入り口。ふつうはカメラ。next() を呼ぶたびに、次の 1 コマ { image, width, height } を返す。
import { openCamera } from "./handlab.js";

/** カメラ。label に名前（の一部）を渡すと、そのカメラを選ぶ。 */
export async function cameraSource(label = "") {
  const cam = await openCamera(label);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = cam.stream;
  await video.play();
  // コマが届いた時刻（performance.now() と同じ物差し）。入力の色（試験機能）でマウスの動きと合わせるのに使う
  const waitFrame = () => new Promise((resolve) => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback((now) => resolve(now));
    else requestAnimationFrame((now) => resolve(now));
  });
  return {
    kind: "camera",
    label: cam.label,
    info: () => `${video.videoWidth}×${video.videoHeight}${cam.fps ? ` / ${Math.round(cam.fps)}fps` : ""}`,
    async next() {
      const t = await waitFrame();
      return { image: video, width: video.videoWidth, height: video.videoHeight, t };
    },
    stop() { cam.stream.getTracks().forEach((t) => t.stop()); },
  };
}

/** カメラの一覧（名前は、一度カメラの使用を許可した後でないと取れない）。 */
export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput" && d.label).map((d) => d.label);
}

/**
 * 開発用：録画のコマを 1 枚ずつ受け取って流す（カメラの無い環境で画面を確かめるため）。
 * URL に ?frames=<コマを返す URL の頭>&n=<コマ数> を付けたときだけ使う。公開サイトでは使わない。
 */
export function frameSource(base, count, fps = 30) {
  let i = 0, last = 0;
  return {
    kind: "frames",
    label: "録画のコマ（開発用）",
    info: () => `コマ ${i}/${count}`,
    async next() {
      const wait = last + 1000 / fps - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = performance.now();
      const bmp = await createImageBitmap(await (await fetch(`${base}&i=${i}`)).blob());
      i = (i + 1) % count;
      return { image: bmp, width: bmp.width, height: bmp.height, t: performance.now(), release: () => bmp.close() };
    },
    stop() {},
  };
}

/** URL を見て、開発用のコマか、カメラかを選ぶ。 */
export async function openSource(label = "") {
  const q = new URLSearchParams(location.search);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);  // 公開サイトでは開発用の入力を使わせない
  if (local && q.has("frames")) return frameSource(q.get("frames"), Number(q.get("n") || 1));
  return cameraSource(label);
}
