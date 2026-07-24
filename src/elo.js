// Plain Elo. Kept separate from engine.js (board rules) so it can be unit-tested
// directly and reused if rating display ever moves client-side.
export const K = 32;
export const START_RATING = 1200;

export const expectedScore = (rating, opponent) =>
  1 / (1 + 10 ** ((opponent - rating) / 400));

// score: 1 win · 0.5 draw · 0 loss. Returns a signed delta, tenths precision.
export const eloDelta = (rating, opponent, score, k = K) =>
  Math.round(k * (score - expectedScore(rating, opponent)) * 10) / 10;
