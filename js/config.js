// 採点の基準値・重み・しきい値。採点を調整するときはこのファイルだけを直す。
// 比率の理想値は美容でよく使われる基準（縦3等分・横5等分など）。
// 「標準顔」の値は face_landmarker.task 内の標準顔（mesh-data.js）を同じ方法で測ったもの。

export const SCORE = {
  // 各項目の重み（合計1）
  weights: { symmetry: 0.30, thirds: 0.20, fifths: 0.20, parts: 0.15, contour: 0.15 },
  // ずれがこの値のとき50点になる（ガウス型で、ずれ0なら100点）
  tolerance: { symmetry: 0.03, thirds: 0.15, fifths: 0.15, parts: 0.15, contour: 0.10 },
  ideal: {
    thirds: 1 / 3,          // 生え際〜眉、眉〜鼻の下、鼻の下〜あご を等しく
    fifths: 1 / 5,          // 顔の幅を目の幅5つ分に
    noseToInner: 1.0,       // 小鼻の幅 ＝ 目と目の間
    mouthToNose: 1.5,       // 口の幅 ＝ 小鼻の幅の1.5倍
    lipToChin: 0.5,         // 鼻の下〜口 ： 口〜あご ＝ 1 ： 2
  },
};

// 基準値を実際の顔のデータで調整している途中の項目（画面に「調整中」と出す）。
// 2026-10-18 の実測で、古典的な基準（横5等分・パーツ比）は平均的な日本人の顔でも大きく外れ、
// 標準顔（テンプレート）由来の輪郭の基準は実際の顔の測り方とずれる（あご先の角度 124° に対し実測 105° など）とわかった。
export const PROVISIONAL = ['fifths', 'parts', 'contour'];

// 輪郭と顔の形の基準（標準顔を「卵型」とする）※暫定。PROVISIONAL を参照
export const SHAPE = {
  reference: { length: 1.34, jaw: 0.775, forehead: 0.82, chin: 124 },
  // 特徴ごとの目盛り（この差で1段階離れているとみなす）
  scale: { length: 0.07, jaw: 0.035, forehead: 0.035, chin: 6 },
  lengthScaleEstimated: 0.12, // 生え際を推定したときは顔の長さを弱めに扱う
  prototypes: {
    egg:      { name: '卵型',     length: 1.34, jaw: 0.775, forehead: 0.82, chin: 124 },
    round:    { name: '丸顔',     length: 1.20, jaw: 0.80,  forehead: 0.82, chin: 132 },
    long:     { name: '面長',     length: 1.50, jaw: 0.765, forehead: 0.81, chin: 120 },
    square:   { name: 'ベース型', length: 1.28, jaw: 0.85,  forehead: 0.83, chin: 134 },
    triangle: { name: '逆三角形', length: 1.36, jaw: 0.72,  forehead: 0.86, chin: 114 },
    diamond:  { name: 'ひし形',   length: 1.36, jaw: 0.73,  forehead: 0.76, chin: 118 },
  },
};

// 撮影の条件
export const CAPTURE = {
  shots: 3,              // 撮る枚数
  framesPerShot: 6,      // 1枚あたり平均するフレーム数
  holdFrames: 10,        // 条件を満たし続けたら撮るまでのフレーム数
  gapMs: 450,            // 1枚撮ったあとの待ち時間
  maxYaw: 6, maxPitch: 8, maxRoll: 8,   // 顔の向きの許容（度）
  minFaceWidth: 0.34, maxFaceWidth: 0.78, // 画面の短い辺に対する顔の幅
  maxCenterOffset: 0.12, // 画面中央からのずれ（短い辺に対する割合）
  maxJawOpen: 0.12, maxSmile: 0.40, maxBlink: 0.50,
};

// 実寸の推定（黒目の横幅の平均）
export const IRIS_MM = 11.7;
