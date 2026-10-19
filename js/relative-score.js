// 相対点は、選んだ基準集団内の実測分布に対する順位。同点には中間順位を使う。
// 人の魅力を予測するモデルも基準分布もないとき、比率スコアから作り替えない。
import { attractivenessFeatures, FEATURE_SCHEMA, FEATURE_COUNT } from './attractiveness-features.js';

export const INPUT_PROJECTION = 'frontalized-uncompensated';
export const MAX_REFERENCE_VALUES = 100000;

export function empiricalPercentile(value, sortedReference) {
  if (!Number.isFinite(value) || !Array.isArray(sortedReference) || !sortedReference.length
    || sortedReference.length > MAX_REFERENCE_VALUES
    || !sortedReference.every((v, i, a) => Number.isFinite(v) && (i === 0 || a[i - 1] <= v))) {
    throw new Error('相対点の基準分布が不正です');
  }
  const bound = (upper) => {
    let lo = 0, hi = sortedReference.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedReference[mid] < value || (upper && sortedReference[mid] === value)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const lower = bound(false), upper = bound(true), n = sortedReference.length;
  return {
    percentile: 100 * (lower + (upper - lower) / 2) / n,
    referenceImages: n,
    outsideReference: value < sortedReference[0] || value > sortedReference[n - 1],
  };
}

export function validateAttractivenessModel(model) {
  if (model?.schemaVersion !== 1 || model?.target !== 'mean-human-attractiveness-rating'
    || model.featureSchema !== FEATURE_SCHEMA || model.inputProjection !== INPUT_PROJECTION
    || model.coefficientSpace !== 'raw-feature-vector'
    || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 256
    || !Array.isArray(model.coefficients) || model.coefficients.length !== FEATURE_COUNT
    || !model.coefficients.every(Number.isFinite) || !Number.isFinite(model.intercept)
    || typeof model.cohort?.label !== 'string' || !model.cohort.label.trim() || model.cohort.label.length > 500
    || model.reference?.kind !== 'heldout-model-predictions'
    || model.reference?.split !== 'calibration'
    || !Array.isArray(model.reference?.values) || !model.reference.values.length
    || model.reference.values.length > MAX_REFERENCE_VALUES
    || !Number.isInteger(model.reference.size) || model.reference.size !== model.reference.values.length) {
    throw new Error('この採点基準には対応していません');
  }
  empiricalPercentile(model.reference.values[0], model.reference.values);
  return model;
}

// アプリの主点は日本人男性限定。画像の見た目やAsianラベルから国籍を推測しない。
// これは出典メタデータの受入検査であり、記載内容や利用条件の確認はモデル作成時に行う。
export function validateJapaneseMaleModel(model) {
  validateAttractivenessModel(model);
  const documentedJapaneseMen = (cohort) => {
    if (cohort?.nationality !== 'JP' || cohort?.gender !== 'male'
      || cohort?.nationalityBasis !== 'source-documented'
      || typeof cohort?.source !== 'string' || cohort.source.length > 2000) return false;
    try {
      const source = new URL(cohort.source);
      return source.protocol === 'https:' && !!source.hostname && !source.username && !source.password;
    } catch { return false; }
  };
  if (![model.trainingCohort, model.cohort, model.evaluation?.cohort].every(documentedJapaneseMen)) {
    throw new Error('学習・校正・検証すべてに、日本人男性と確認できる出典付きの採点基準が必要です');
  }
  return model;
}

export function predictAttractiveness(points, model) {
  validateAttractivenessModel(model);
  const x = attractivenessFeatures(points);
  const raw = x.reduce((s, v, i) => s + v * model.coefficients[i], model.intercept);
  if (!Number.isFinite(raw)) throw new Error('採点基準から有効な予測値を計算できません');
  return { ...empiricalPercentile(raw, model.reference.values), raw, modelId: model.id, cohort: model.cohort.label };
}
