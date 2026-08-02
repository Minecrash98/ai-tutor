export function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!Number.isInteger(successes) || !Number.isInteger(total)) {
    throw new Error("successes and total must be integers");
  }
  if (total < 0 || successes < 0 || successes > total) {
    throw new Error("invalid binary count");
  }
  if (total === 0) return { lower: null, upper: null };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function summarizeBinary(values) {
  const total = values.length;
  const successes = values.filter((value) => value === true).length;
  const missing = values.filter((value) => value === null).length;
  const primarySuccesses = successes;
  const interval = wilsonInterval(primarySuccesses, total);
  return {
    successes: primarySuccesses,
    total,
    missing,
    rate: total === 0 ? null : primarySuccesses / total,
    wilson95: interval,
  };
}

export function summarizeDelayed(values) {
  const observed = values.filter((value) => value !== null);
  const observedSuccesses = observed.filter((value) => value === true).length;
  return {
    observed: summarizeBinary(observed),
    missing: values.length - observed.length,
    worstCase: summarizeBinary(
      values.map((value) => (value === null ? false : value)),
    ),
    bestCase: summarizeBinary(
      values.map((value) => (value === null ? true : value)),
    ),
    observedSuccesses,
  };
}

export function requiredPerGroupForTwoProportions(
  controlRate,
  treatmentRate,
  alphaZ = 1.959963984540054,
  powerZ = 0.8416212335729143,
) {
  if (
    controlRate <= 0 ||
    controlRate >= 1 ||
    treatmentRate <= 0 ||
    treatmentRate >= 1 ||
    controlRate === treatmentRate
  ) {
    throw new Error("rates must differ and be strictly between zero and one");
  }
  const pooled = (controlRate + treatmentRate) / 2;
  const numerator =
    alphaZ * Math.sqrt(2 * pooled * (1 - pooled)) +
    powerZ *
      Math.sqrt(
        controlRate * (1 - controlRate) +
          treatmentRate * (1 - treatmentRate),
      );
  return Math.ceil(
    (numerator * numerator) /
      ((treatmentRate - controlRate) * (treatmentRate - controlRate)),
  );
}
