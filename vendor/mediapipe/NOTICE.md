# MediaPipe Tasks Vision（同梱）

- パッケージ：@mediapipe/tasks-vision 1.0.1（npm、2026-07-31 公開）
- 同梱したファイル：vision_bundle.mjs、wasm/vision_wasm_internal.js・.wasm、wasm/vision_wasm_nosimd_internal.js・.wasm（変更なし）
- モデル：models/face_landmarker.task（float16/1、Google の配布元から取得、変更なし）
- ライセンス：Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- Copyright The MediaPipe Authors.

このライブラリは画像を端末の中だけで処理します。利用状況の統計を Google に送る処理が含まれていますが、
このアプリでは index.html の Content-Security-Policy（connect-src 'self'）で外部への通信を止めています。
