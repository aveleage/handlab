// HandLab の中核。
// カメラ映像 → 手の骨格（MediaPipe）→ 前腕の向き（ArmNet）→ 手首の角度 → テンション、までを
// すべてこのページを開いている PC のブラウザの中で計算する。映像はどこにも送らない。
//
// 録画・学習用の Python 版（AimHand: aimhand/analyze/armnet.py, forearm.py, preview/draw.py）と同じ計算を JavaScript に移したもの。
// 数値（切り出しの大きさ、しきい値、色）は Python 版と合わせてある。変えるときは両方を直すこと。

// 開発の寄付の受付ページ。空のあいだは、寄付のボタンを出さず「準備中」と出す
export const DONATE_URL = "https://ko-fi.com/racran";
const MP_VERSION = "1.2.3";
const ORT_VERSION = "1.31.1";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

// ---- ArmNet に渡す切り出し画像（armnet.py と同じ） ----
export const PATCH = 64; // 切り出す画像の一辺（px）
export const PALM_PX = 19; // 切り出した画像の中での、手のひらの長さ（px）
export const WRIST_AT = [32, 22]; // 切り出した画像の中での、手首の位置
const FILL = 127; // 画面の外にあたる部分の明るさ
const SUPER = 4; // 切り出しは一度この倍率で大きく描いてから、平均して縮める（Python 版の「面積平均での縮小」に合わせるため）
export const MIN_CONFIDENCE = 0.5; // 「前腕が見えている」の確からしさがこれ未満なら、測定なし
const FOREARM_DRAW = 1.3; // 前腕の線を、手首から手のひらの長さの何倍ぶん描くか
const MIN_PALM = 20; // 手のひらがこれより短く映っていたら（px）測らない

// ---- テンション（forearm.py と同じ） ----
export const GLOW_START = 50; // テンションの絶対値がこの % を超えたら、縁を赤くし始める
const GLOW_DEPTH = 0.16; // 赤い縁の幅（画面の幅・高さに対する割合）
const GLOW_MAX_ALPHA = 0.55; // 赤い縁のいちばん濃い所の不透明度
export const MIN_RANGE_DEG = 5; // 可動域として認める、中立から上限・下限までの最小の角度

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

/** フレーム → 切り出し画像 の変換。canvas の setTransform に渡す順 [a, b, c, d, e, f] で返す。手が小さすぎれば null。 */
export function patchTransform(wrist, mcp) {
  const dx = mcp[0] - wrist[0], dy = mcp[1] - wrist[1];
  const palm = Math.hypot(dx, dy);
  if (!(palm >= MIN_PALM)) return null;
  const up = [dx / palm, dy / palm]; // 手の向き（手首 → 中指の付け根）
  const right = [-up[1], up[0]];
  const s = PALM_PX / palm;
  // 切り出し画像の x = s * (p − wrist)・right + WRIST_AT.x、 y = −s * (p − wrist)・up + WRIST_AT.y
  const m00 = s * right[0], m01 = s * right[1], m10 = -s * up[0], m11 = -s * up[1];
  const t0 = WRIST_AT[0] - (m00 * wrist[0] + m01 * wrist[1]);
  const t1 = WRIST_AT[1] - (m10 * wrist[0] + m11 * wrist[1]);
  return [m00, m10, m01, m11, t0, t1];
}

/** 手首の角度から「前腕の点」（線を描くための点）を作る。 */
export function forearmPointFromAngle(wrist, mcp, angleDeg, ratio = FOREARM_DRAW) {
  const dx = wrist[0] - mcp[0], dy = wrist[1] - mcp[1];
  const palm = Math.hypot(dx, dy);
  const back = [dx / palm, dy / palm];
  const a = (-angleDeg * Math.PI) / 180; // 手の向きの逆から、角度のぶんだけ戻した向きが前腕
  const dir = [back[0] * Math.cos(a) - back[1] * Math.sin(a), back[0] * Math.sin(a) + back[1] * Math.cos(a)];
  return [wrist[0] + dir[0] * ratio * palm, wrist[1] + dir[1] * ratio * palm];
}

/** 手首の左右の曲がり（度）。映像の上で、手が時計回りに傾くと正。 */
export function wristAngleDeg(wrist, mcp, forearm) {
  const sx = wrist[0] - forearm[0], sy = wrist[1] - forearm[1];
  const hx = mcp[0] - wrist[0], hy = mcp[1] - wrist[1];
  return (Math.atan2(sx * hy - sy * hx, sx * hx + sy * hy) * 180) / Math.PI;
}

/** 可動域 {min, neutral, max} が使える値かどうか。使えなければ null。 */
export function validRange(r) {
  if (!r) return null;
  const lo = Number(r.min), mid = Number(r.neutral), hi = Number(r.max);
  if (![lo, mid, hi].every(Number.isFinite) || mid - lo < MIN_RANGE_DEG || hi - mid < MIN_RANGE_DEG) return null;
  return { min: lo, neutral: mid, max: hi };
}

/** 手首の角度を、その人の可動域に対する割合（−100〜+100）に直す。中立が 0。 */
export function tensionPercent(angle, r) {
  const v = angle >= r.neutral ? ((angle - r.neutral) / (r.max - r.neutral)) * 100 : (-(r.neutral - angle) / (r.neutral - r.min)) * 100;
  return Math.max(-100, Math.min(100, v));
}

/** 縁を赤くする強さ（0〜1）。50% までは 0、100% で 1。 */
export function tensionGlow(tension) {
  return Math.max(0, Math.min(1, (Math.abs(tension) - GLOW_START) / (100 - GLOW_START)));
}

/** 手が傾いている向きが、画面のどの端にあたるか。 */
export function tiltSide(wrist, forearm, tension) {
  const sx = wrist[0] - forearm[0], sy = wrist[1] - forearm[1];
  const sign = tension >= 0 ? 1 : -1;
  const lx = -sy * sign, ly = sx * sign; // 進行方向に対して時計回り側の横向き
  if (Math.abs(lx) >= Math.abs(ly)) return lx > 0 ? "right" : "left";
  return ly > 0 ? "bottom" : "top";
}

/** 手の骨格と前腕のモデルをまとめたもの。create() で読み込み、analyze() を 1 コマごとに呼ぶ。 */
export class Engine {
  static async create({ modelBase = "models/", delegate = "GPU", onProgress = () => {} } = {}) {
    const engine = new Engine();
    onProgress("loadHands");
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const options = (d) => ({
      baseOptions: { modelAssetPath: `${modelBase}hand_landmarker.task`, delegate: d },
      runningMode: "VIDEO",
      numHands: 1,
    });
    try {
      engine.hands = await vision.HandLandmarker.createFromOptions(fileset, options(delegate));
      engine.delegate = delegate;
    } catch (e) {
      // GPU が使えない環境では CPU で動かす
      engine.hands = await vision.HandLandmarker.createFromOptions(fileset, options("CPU"));
      engine.delegate = "CPU";
    }
    onProgress("loadArm");
    const ort = await import(`${ORT_BASE}ort.wasm.min.mjs`);
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1; // 複数スレッドは特別なサーバー設定が要るので使わない（モデルが小さいので十分速い）
    engine.ort = ort;
    engine.arm = await ort.InferenceSession.create(`${modelBase}armnet.onnx`, { executionProviders: ["wasm"] });
    engine.patchCanvas = new OffscreenCanvas(PATCH * SUPER, PATCH * SUPER);
    engine.patchCtx = engine.patchCanvas.getContext("2d", { willReadFrequently: true });
    engine.patchData = new Float32Array(3 * PATCH * PATCH);
    engine.lastMs = 0;
    onProgress("");
    return engine;
  }

  /** 手首まわりを、向きと大きさをそろえて切り出す（Python 版の wrist_patch と同じ並びの BGR・0〜1・CHW）。 */
  patch(source, wrist, mcp) {
    const t = patchTransform(wrist, mcp);
    if (!t) return null;
    const ctx = this.patchCtx, big = PATCH * SUPER;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${FILL},${FILL},${FILL})`;
    ctx.fillRect(0, 0, big, big);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(...t.map((v) => v * SUPER));
    ctx.drawImage(source, 0, 0);
    const rgba = ctx.getImageData(0, 0, big, big).data;
    const out = this.patchData, n = PATCH * PATCH, k = 1 / (SUPER * SUPER * 255);
    for (let y = 0; y < PATCH; y++) {
      for (let x = 0; x < PATCH; x++) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < SUPER; dy++) {
          let j = ((y * SUPER + dy) * big + x * SUPER) * 4;
          for (let dx = 0; dx < SUPER; dx++, j += 4) { r += rgba[j]; g += rgba[j + 1]; b += rgba[j + 2]; }
        }
        const i = y * PATCH + x;
        out[i] = b * k; // B
        out[n + i] = g * k; // G
        out[2 * n + i] = r * k; // R
      }
    }
    return out;
  }

  /**
   * 1 コマを解析する。source は video か canvas、width・height はその大きさ（px）。
   * 戻り値: { points: [[x, y] × 21] | null, angle, confidence, forearm: [x, y] | null }
   *   angle は前腕が見えていないと null。points は手が映っていないと null。
   */
  async analyze(source, width, height, nowMs = performance.now()) {
    const ms = Math.max(nowMs, this.lastMs + 1); // MediaPipe には、必ず増えていく時刻を渡す
    this.lastMs = ms;
    const found = this.hands.detectForVideo(source, ms);
    const lm = found.landmarks && found.landmarks[0];
    if (!lm) return { points: null, angle: null, confidence: 0, forearm: null };
    const points = lm.map((p) => [p.x * width, p.y * height]);
    const wrist = points[0], mcp = points[9];
    const data = this.patch(source, wrist, mcp);
    if (!data) return { points, angle: null, confidence: 0, forearm: null };
    const result = await this.arm.run({ image: new this.ort.Tensor("float32", data, [1, 3, PATCH, PATCH]) });
    const [sin, cos, logit] = result.out.data;
    const confidence = 1 / (1 + Math.exp(-logit));
    if (confidence < MIN_CONFIDENCE) return { points, angle: null, confidence, forearm: null };
    const angle = (Math.atan2(sin, cos) * 180) / Math.PI;
    return { points, angle, confidence, forearm: forearmPointFromAngle(wrist, mcp, angle) };
  }
}

// ---- 映像の向き ----
// カメラの置き方に合わせて、映像を回したり裏返したりする。OBS 側で裏返すとゲージや赤い縁まで裏返るので、ここで映像だけを直す。
// 向きを直した映像を「元の映像」として、以降の解析も描画もすべてその上で行う（骨格・切り抜き・赤い縁が自然にそろう）。

/** 向き {rot: 0|90|180|270（時計回り）, fh: 左右反転, fv: 上下反転} を、決まった形にそろえる。回してから裏返す。 */
export function cleanOrient(o) {
  const rot = ((Math.round(Number(o && o.rot) / 90) * 90) % 360 + 360) % 360 || 0;
  return { rot, fh: !!(o && o.fh), fv: !!(o && o.fv) };
}

/** 向きを直す必要があるか。 */
export const isOriented = (o) => !!(o && (o.rot || o.fh || o.fv));

/** 鏡像になっているか（左右か上下の片方だけ反転）。鏡像では、手首の角度の正負が逆になる。 */
export const isMirrored = (o) => !!(o && o.fh !== o.fv);

/**
 * 映像の向きを直して canvas に描き、{ image, width, height } を返す。直す必要が無ければ、元の映像をそのまま返す。
 * canvas は呼ぶ側が 1 枚用意して使い回す。
 */
export function orientFrame(canvas, image, width, height, orient) {
  const o = cleanOrient(orient);
  if (!isOriented(o)) return { image, width, height };
  const side = o.rot === 90 || o.rot === 270;
  const w = side ? height : width, h = side ? width : height;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(w / 2, h / 2);
  ctx.scale(o.fh ? -1 : 1, o.fv ? -1 : 1);
  ctx.rotate((o.rot * Math.PI) / 180);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  return { image: canvas, width: w, height: h };
}

/** 鏡像に切り替えた（または戻した）ときの可動域。角度の正負が逆になるので、上下を入れ替えて符号を返す。 */
export function mirrorRange(r) {
  return r ? { min: -r.max, neutral: -r.neutral, max: -r.min } : null;
}

/** 切り抜き {l, t, r, b}（各辺から落とす割合）を、決まった範囲にそろえる。 */
export function cleanCrop(c) {
  const v = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(0.95, Number(x))) : 0);
  const out = { l: v(c && c.l), t: v(c && c.t), r: v(c && c.r), b: v(c && c.b) };
  for (const [a, b] of [["l", "r"], ["t", "b"]]) {
    const total = out[a] + out[b];
    if (total > 0.95) { out[a] *= 0.95 / total; out[b] *= 0.95 / total; }
  }
  return out;
}

/**
 * 映像に骨格・前腕の線・テンションの赤い縁を重ねて描く。
 * canvas の大きさは、切り抜いた後の大きさに合わせる（赤い縁は切り抜いた後の端に付く）。
 * opts: { crop, skeleton, tension（null なら縁なし）, side }
 */
// ---- 入力の色（試験機能） ----
// 手のひらの中心に円を描き、色はマウスが読んだ速さ（cm/秒）だけで決める（アプリ版と同じ）。
// 入力が無ければ青。円（手）が動いているのに青なら、マウスが浮いている = リフトだと、見て分かる。
// ブラウザがマウスの動きを読めるのは、このページがマウスを捕まえている間（Pointer Lock）だけ。
const SPEED_COLORS = [[255, 214, 10], [255, 128, 16], [255, 40, 36]]; // 黄 → 橙 → 赤
const IDLE_RGB = [150, 205, 255]; // 入力が無いときの薄い青
export const COLOR_MID_CM_S = 30; // この速さで橙
export const COLOR_MAX_CM_S = 80; // この速さ以上は赤
export const MOTION_TRAIL_MS = 400; // 少し前の位置を薄く残す長さ
export const CAMERA_LAG_MS = 40; // 映像はマウスより少し遅れて届く（アプリ版の録画で 35〜45ms）
const PALM_POINTS = [0, 5, 9, 13, 17];

/** マウスの速さ（cm/秒）→ 色 [r, g, b]。0 は青、少しでも読めば黄 → 30 で橙 → 80 以上で赤。 */
export function speedColor(v) {
  if (!(v > 0)) return IDLE_RGB;
  const [a, b, f] = v < COLOR_MID_CM_S ? [SPEED_COLORS[0], SPEED_COLORS[1], v / COLOR_MID_CM_S]
    : [SPEED_COLORS[1], SPEED_COLORS[2], Math.min(1, (v - COLOR_MID_CM_S) / (COLOR_MAX_CM_S - COLOR_MID_CM_S))];
  return a.map((x, n) => Math.round(x + (b[n] - x) * f));
}

/** 手のひらの中心（手首と 4 本の指の付け根の平均）と、手のひらの長さ。 */
export function palmOf(points) {
  const x = PALM_POINTS.reduce((s, i) => s + points[i][0], 0) / PALM_POINTS.length;
  const y = PALM_POINTS.reduce((s, i) => s + points[i][1], 0) / PALM_POINTS.length;
  return { x, y, palm: Math.hypot(points[9][0] - points[0][0], points[9][1] - points[0][1]) };
}

/** マウスの動き（カウント）を時刻つきで貯め、ある区間の合計を返す。古いものは捨てる。 */
export class MouseMeter {
  constructor(keepMs = 2000) { this.keep = keepMs; this.t = []; this.d = []; }
  add(t, dx, dy) {
    if (!dx && !dy) return;
    this.t.push(t); this.d.push([dx, dy]);
    while (this.t.length && this.t[0] < t - this.keep) { this.t.shift(); this.d.shift(); }
  }
  /** 時刻 (t0, t1] のカウントの合計 [dx, dy]。 */
  sum(t0, t1) {
    let x = 0, y = 0;
    for (let i = 0; i < this.t.length; i++) if (this.t[i] > t0 && this.t[i] <= t1) { x += this.d[i][0]; y += this.d[i][1]; }
    return [x, y];
  }
}

/** 円と尾を描く。trail は古い順の {t, x, y, palm, v}（映像の px と cm/秒）。(x0, y0) は映像の切り抜きの左上。 */
export function drawMotion(ctx, trail, now, x0 = 0, y0 = 0, lineScale = 1) {
  const items = trail.filter((m) => now - m.t >= 0 && now - m.t <= MOTION_TRAIL_MS);
  if (!items.length) return;
  const cur = items[items.length - 1].t === now ? items[items.length - 1] : null;
  const look = (m) => {
    const age = Math.min(1, (now - m.t) / MOTION_TRAIL_MS), s = Math.min(1, m.v / COLOR_MAX_CM_S);
    return { x: m.x - x0, y: m.y - y0, r: Math.max(4, 0.55 * m.palm * (1 - 0.5 * age)), rgb: speedColor(m.v).join(","),
      a: (m.v > 0 ? 0.25 + 0.4 * s : 0.45) * Math.pow(1 - age, 1.6), s, idle: !(m.v > 0) };
  };
  const dot = (x, y, r, rgb, a) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fillStyle = `rgba(${rgb},${a})`; ctx.fill(); };
  let prev = null;
  for (const m of items) {  // 尾。速く動いた所は、間を細かく埋めて、ひと続きに見えるようにする（重なるぶん薄く）
    const c = look(m);
    if (prev) {
      const n = Math.max(1, Math.min(10, Math.ceil(Math.hypot(c.x - prev.x, c.y - prev.y) / (c.r * 0.5))));
      for (let i = 1; i <= (m === cur ? n - 1 : n); i++) {
        const f = i / n;
        dot(prev.x + (c.x - prev.x) * f, prev.y + (c.y - prev.y) * f, prev.r + (c.r - prev.r) * f, c.rgb, c.a * (n > 1 ? 0.45 : 1));
      }
    } else if (m !== cur) dot(c.x, c.y, c.r, c.rgb, c.a);
    prev = c;
  }
  if (cur) {  // いまの位置は濃く塗って縁取りし、止まっていても場所が分かるようにする
    const c = look(cur);
    dot(c.x, c.y, c.r, c.rgb, c.idle ? 0.45 : 0.3 + 0.4 * c.s);
    ctx.lineWidth = 2.5 * lineScale; ctx.strokeStyle = `rgba(${c.rgb},${c.idle ? 0.95 : 0.6 + 0.4 * c.s})`; ctx.stroke();
  }
}

export function render(canvas, source, width, height, result, opts = {}) {
  const crop = cleanCrop(opts.crop);
  const x0 = Math.round(crop.l * width), y0 = Math.round(crop.t * height);
  const w = Math.max(2, Math.round((1 - crop.l - crop.r) * width)), h = Math.max(2, Math.round((1 - crop.t - crop.b) * height));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  const s = Math.max(1, width / 1280); // 線の太さは 1280px 幅を基準にする
  if (opts.motion) drawMotion(ctx, opts.motion.trail, opts.motion.now, x0, y0, s);  // 骨格より下に描く
  if (opts.skeleton !== false && result && result.points) {
    const p = result.points.map(([x, y]) => [x - x0, y - y0]);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    for (const [a, b] of BONES) { ctx.moveTo(p[a][0], p[a][1]); ctx.lineTo(p[b][0], p[b][1]); }
    ctx.stroke();
    if (result.forearm) {
      const f = [result.forearm[0] - x0, result.forearm[1] - y0];
      ctx.strokeStyle = "#50ff50";
      ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(f[0], f[1]); ctx.stroke();
      ctx.fillStyle = "#ffe000";
      ctx.beginPath(); ctx.arc(f[0], f[1], 5 * s, 0, 7); ctx.fill();
    }
    ctx.fillStyle = "#2a2aff";
    for (let i = 1; i < p.length; i++) { ctx.beginPath(); ctx.arc(p[i][0], p[i][1], 3.5 * s, 0, 7); ctx.fill(); }
    ctx.fillStyle = "#ff2020";
    ctx.beginPath(); ctx.arc(p[0][0], p[0][1], 6.5 * s, 0, 7); ctx.fill();
  }
  const strength = opts.tension == null ? 0 : tensionGlow(opts.tension);
  if (strength > 0 && opts.side) {
    const depth = opts.side === "left" || opts.side === "right" ? w * GLOW_DEPTH : h * GLOW_DEPTH;
    const from = { left: [0, 0, depth, 0], right: [w, 0, w - depth, 0], top: [0, 0, 0, depth], bottom: [0, h, 0, h - depth] }[opts.side];
    const g = ctx.createLinearGradient(...from);
    g.addColorStop(0, `rgba(239,45,45,${GLOW_MAX_ALPHA * strength})`);
    g.addColorStop(1, "rgba(239,45,45,0)");
    ctx.fillStyle = g;
    if (opts.side === "left") ctx.fillRect(0, 0, depth, h);
    else if (opts.side === "right") ctx.fillRect(w - depth, 0, depth, h);
    else if (opts.side === "top") ctx.fillRect(0, 0, w, depth);
    else ctx.fillRect(0, h - depth, w, depth);
  }
}

// ---- 設定（このブラウザの中だけに保存する） ----
const STORE_KEY = "handlab.v1";
const OLD_STORE_KEY = "aimhand.v1"; // 改名前（AimHand）の保存先。新しいほうが無ければ、こちらを読む
// lang は画面の言語（"" なら、ブラウザの言語に合わせる）。theme は見た目（"" と "dark" は黒基調、"light" は明るい色）
export const DEFAULT_SETTINGS = { range: null, crop: { l: 0, t: 0, r: 0, b: 0 }, skeleton: true, gauge: true, camera: "", lang: "", theme: "", orient: { rot: 0, fh: false, fv: false }, motion: false, dpi: 1600 };

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(OLD_STORE_KEY) || "{}") || {};
  } catch (e) { /* 壊れていたら初期値 */ }
  return { ...DEFAULT_SETTINGS, ...saved, range: validRange(saved.range), crop: cleanCrop(saved.crop), orient: cleanOrient(saved.orient) };
}

export function saveSettings(settings) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* 保存できなくても動かす */ }
}

/** 設定を URL の # 以降に入れる（OBS のブラウザソースは別のブラウザ扱いで、保存した設定が見えないため）。 */
export function settingsToHash(s) {
  const parts = [];  // 数字とカンマだけなので、そのまま並べる（読みやすい URL にする）
  const n = (v, d) => Number(v).toFixed(d).replace(/\.?0+$/, "");
  if (s.range) parts.push("r=" + [s.range.min, s.range.neutral, s.range.max].map((v) => n(v, 1)).join(","));
  const c = cleanCrop(s.crop);
  if (c.l || c.t || c.r || c.b) parts.push("c=" + [c.l, c.t, c.r, c.b].map((v) => n(v, 4)).join(","));
  if (s.skeleton === false) parts.push("s=0");
  if (s.gauge === false) parts.push("g=0");
  if (s.camera) parts.push("cam=" + encodeURIComponent(s.camera));
  const o = cleanOrient(s.orient);
  if (isOriented(o)) parts.push(`o=${o.rot},${o.fh ? 1 : 0},${o.fv ? 1 : 0}`);  // 向き：回転（度）, 左右反転, 上下反転
  if (s.lang) parts.push("l=" + encodeURIComponent(s.lang));
  return parts.join("&");
}

/** settingsToHash の逆。URL に無い項目は base（保存済みの設定）のまま。 */
export function settingsFromHash(hash, base = DEFAULT_SETTINGS) {
  const q = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const out = { ...base };
  if (q.has("r")) { const [min, neutral, max] = q.get("r").split(",").map(Number); out.range = validRange({ min, neutral, max }); }
  if (q.has("c")) { const [l, t, r, b] = q.get("c").split(",").map(Number); out.crop = cleanCrop({ l, t, r, b }); }
  if (q.has("s")) out.skeleton = q.get("s") !== "0";
  if (q.has("g")) out.gauge = q.get("g") !== "0";
  if (q.has("cam")) out.camera = q.get("cam");
  if (q.has("o")) { const [rot, fh, fv] = q.get("o").split(","); out.orient = cleanOrient({ rot: Number(rot), fh: fh === "1", fv: fv === "1" }); }
  if (q.has("l")) out.lang = q.get("l");
  return out;
}

// カメラへの頼み方。上から順に試し、開けたものを使う。
// 「できれば 60fps」と頼むと、対応していないのに受け付けてしまい、映像を出せずに失敗するカメラがある
// （ELECOM 8MP Webcam を OBS のブラウザソース＝Chromium で開いたときに確認。エラーは「使用中」と同じ NotReadableError になる）。
// そのため、失敗したら頼み方をゆるめて試し直す。
const CAMERA_REQUESTS = [
  { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  { width: { ideal: 1280 }, height: { ideal: 720 } },
  {},
];

async function requestCamera(deviceId) {
  let lastError = null;
  for (const want of CAMERA_REQUESTS) {
    const video = deviceId ? { ...want, deviceId: { exact: deviceId } } : (Object.keys(want).length ? want : true);
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      lastError = e;
      // 許可されていない・カメラが無い場合は、頼み方を変えても同じなので、すぐやめる
      if (e.name === "NotAllowedError" || e.name === "SecurityError" || e.name === "NotFoundError") break;
    }
  }
  throw lastError;
}

/**
 * カメラを開く。label に名前の一部を渡すと、その名前のカメラを選ぶ（無ければ最初のカメラ）。
 * 戻り値: { stream, label, width, height, fps }
 */
export async function openCamera(label = "") {
  let stream = await requestCamera("");
  if (label) {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const pick = devices.find((d) => d.label === label) || devices.find((d) => d.label.includes(label));
    const current = stream.getVideoTracks()[0];
    if (pick && pick.label !== current.label) {
      current.stop();
      stream = await requestCamera(pick.deviceId);
    }
  }
  const track = stream.getVideoTracks()[0], st = track.getSettings();
  return { stream, label: track.label, width: st.width, height: st.height, fps: st.frameRate };
}

/** 直近の回数から 1 秒あたりの回数を出す小さなカウンター。 */
export class Rate {
  constructor(windowMs = 2000) { this.windowMs = windowMs; this.times = []; }
  tick(now = performance.now()) { this.times.push(now); while (this.times.length && this.times[0] < now - this.windowMs) this.times.shift(); }
  get fps() { return this.times.length < 2 ? 0 : ((this.times.length - 1) * 1000) / (this.times[this.times.length - 1] - this.times[0]); }
}
