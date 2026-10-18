// 採点の基準値・重み・しきい値。採点を調整するときはこのファイルだけを直す。
// 左右対称・縦のバランスは美容でよく使われる基準（左右がそろう・縦3等分）との差で採点する。
// 横のバランス・パーツの配置・輪郭は「平均顔との近さ」で採点する（2026-10-19 本人の決定。企画・仕様メモ §7）。

// 平均顔：公開データ FairFace（Kärkkäinen & Joo 2021, CC BY 4.0）の東アジア人男性 20〜39歳のうち、
// 正面（±6°）・無表情の 204 人を、アプリと同じ処理（MediaPipe → 正面化 → analysis.js の measure）で測った平均と標準偏差。
// 平均は「遠くから見た形（正射影）」に直した値（写真は平均 1.5m ほどの距離で撮られたと仮定し、標準顔で試算した差だけずらした）。
// 標準偏差は、同じ写真を測り直したときのぶれを除いた値。計算は _work/calib/calibrate.mjs。
// 比率の定義：innerToEye＝目の間÷目の幅、outerToEye＝目尻〜輪郭÷目の幅、noseToInner＝小鼻÷目の間、
// mouthToNose＝口÷小鼻、lipToChin＝鼻の下〜口÷口〜あご、length＝顔の縦横比（額の高さは眉〜鼻の下と同じとみなす）、
// jaw＝あご幅÷顔幅、forehead＝額幅÷顔幅、chin＝あご先の角度（度）
export const NORM = {
  innerToEye: { mean: 1.370, sd: 0.084 },
  outerToEye: { mean: 1.143, sd: 0.127 },
  noseToInner: { mean: 1.156, sd: 0.072 },
  mouthToNose: { mean: 1.238, sd: 0.078 },
  lipToChin: { mean: 0.500, sd: 0.061 },
  length: { mean: 1.321, sd: 0.083 },
  jaw: { mean: 0.810, sd: 0.020 },
  forehead: { mean: 0.826, sd: 0.020 },
  chin: { mean: 124.2, sd: 4.8 },
};

export const SCORE = {
  // 各項目の重み（合計1）
  weights: { symmetry: 0.30, thirds: 0.20, fifths: 0.20, parts: 0.15, contour: 0.15 },
  // ずれがこの値のとき50点になる（ガウス型で、ずれ0なら100点）。
  // 左右対称・縦：割合のずれ。横・パーツ・輪郭：平均顔からのずれ（各比率が標準偏差の何倍離れているかの二乗平均）で、
  // 公開データの真ん中の人（平均的な人）がちょうど50点になる値（計測のぶれで大きく出る分は割り引いた）。
  tolerance: { symmetry: 0.03, thirds: 0.15, fifths: 0.802, parts: 0.870, contour: 0.847 },
  ideal: {
    thirds: 1 / 3,          // 生え際〜眉、眉〜鼻の下、鼻の下〜あご を等しく
  },
};

// 基準値を実際の顔のデータで調整している途中の項目（画面に「調整中」と出す）。
// 2026-10-19 に横のバランス・パーツの配置・輪郭を公開データの平均顔にもとづく基準へ直したので、今はなし。
export const PROVISIONAL = [];

// 輪郭と顔の形の基準。卵型＝平均顔。ほかの形は、以前の基準（標準顔＝卵型）での位置を
// 「標準偏差の何倍か」で保ったまま、中心と目盛りを平均顔の平均・標準偏差に置き換えたもの。
export const SHAPE = {
  reference: { length: NORM.length.mean, jaw: NORM.jaw.mean, forehead: NORM.forehead.mean, chin: NORM.chin.mean },
  // 特徴ごとの目盛り（この差で1段階離れているとみなす）＝平均顔の標準偏差
  scale: { length: NORM.length.sd, jaw: NORM.jaw.sd, forehead: NORM.forehead.sd, chin: NORM.chin.sd },
  prototypes: {
    egg:      { name: '卵型',     length: 1.321, jaw: 0.810, forehead: 0.826, chin: 124.2 },
    round:    { name: '丸顔',     length: 1.156, jaw: 0.825, forehead: 0.826, chin: 130.6 },
    long:     { name: '面長',     length: 1.509, jaw: 0.805, forehead: 0.820, chin: 120.9 },
    square:   { name: 'ベース型', length: 1.250, jaw: 0.853, forehead: 0.832, chin: 132.2 },
    triangle: { name: '逆三角形', length: 1.344, jaw: 0.779, forehead: 0.849, chin: 116.1 },
    diamond:  { name: 'ひし形',   length: 1.344, jaw: 0.785, forehead: 0.792, chin: 119.3 },
  },
};

// 撮影の条件（2026-10-18 精度優先に見直し）
export const CAPTURE = {
  shots: 3,              // 撮る枚数
  framesPerShot: 8,      // 1枚あたり平均するフレーム数
  holdFrames: 6,         // 条件を満たし続けたら撮るまでのフレーム数
  gapMs: 300,            // 1枚撮ったあとの待ち時間
  maxYaw: 4, maxPitch: 6, maxRoll: 8,   // 顔の向きの許容（度）。roll は正面化で正確に戻るので緩め
  minFaceWidth: 0.30, maxFaceWidth: 0.80, // 画面の短い辺に対する顔の幅
  maxCenterOffset: 0.12, // 画面中央からのずれ（短い辺に対する割合）
  maxJawOpen: 0.12, maxSmile: 0.40, maxBlink: 0.50,
  maxMotion: 0.006,      // 前のフレームからの点の動き（顔の幅に対する平均）。超えたらぶれとみなす
  minDistanceCm: 28, maxDistanceCm: 90, // 撮影距離の目安（黒目の大きさと画角から推定）
  minLuma: 60,           // 顔の明るさ（0〜255）の下限
};

// カメラ：焦点距離＝長い辺の画素数×focalRatio（水平画角 約72°。スマホの前面カメラ・PC のカメラはおおむね 68〜76°）
// 遠近の補正（geometry.js の undoPerspective）と撮影距離の推定に使う。
export const CAMERA = { focalRatio: 0.68 };

// 実寸の推定（黒目の横幅の平均）
export const IRIS_MM = 11.7;
