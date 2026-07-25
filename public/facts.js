// Did-you-knows. A visitor should meet a new one most times they arrive, and a regular should
// still be surprised, so the corpus is deliberately larger than the number of visits anyone makes
// in a sitting. Order is shuffled per visit and the last-seen fact is persisted, which is the
// cheapest way to guarantee no fact repeats back-to-back across a reload.

export const FACTS = Object.freeze([
  // ── this game ──
  'All 192 starting positions a JANKEN layout can legally deal on the 3×3 board are drawn. Every one, under all seven movement archetypes.',
  'The 3×3 board has 207,775 legal piece placements, or 415,550 once you count whose turn it is.',
  'The longest forced win on the solved 3×3 board takes 18 plies. Nobody has ever needed it.',
  'A solved 3×3 table is 406 KB flat and compresses to as little as 43 KB, because most of it is the same answer over and over.',
  'The 3×3 tablebase ignores the no-progress clock, exactly as chess tablebases ignore the fifty-move rule. It changes 1.43% of verdicts and no legal opening.',
  'Because every 3×3 variant gives all three pieces the same movement, relabelling rock→paper→scissors is a symmetry of the game. That triples the symmetry group to order 24.',
  'Threefold repetition cannot change a tablebase verdict. A forced win never needs to visit the same position twice.',
  'JANKEN elimination ends when no capture is possible any more, judged on surviving piece types. Rocks alone against rocks alone is over, whatever the geometry.',
  'On the 3×3 board there is no zugzwang: no position where being obliged to move is what loses you the game.',
  'Rock beats scissors beats paper beats rock is the smallest interesting example of a non-transitive relation, which is why no piece can be "the best piece".',
  'A piece you cannot capture still blocks you. Half of JANKEN strategy is standing somewhere inconvenient.',
  'Ink trails only exist for rooks, bishops and queens, because they are the only pieces that pass through squares rather than over them.',

  // ── Conway ──
  'John Conway invented the Game of Life in 1970 using a Go board, because he did not have a computer to hand.',
  'Conway disliked being famous for the Game of Life. He considered the surreal numbers his better invention.',
  'Conway discovered the surreal numbers by analysing Go endgames, then found they contained the real numbers and the ordinals at once.',
  'Conway could recite the day of the week for any date using his Doomsday algorithm, and kept a computer program quizzing him each time he logged in.',
  'Conway proved that every finite two-player game with no chance and no hidden information has a value, and that those values can be added together like numbers.',
  'The game of Hackenbush has positions worth exactly one half, one quarter, and stranger things besides. Conway showed a game can be worth a fraction.',
  'Conway named the "nimber" and the "surreal number", and also the Look-and-Say sequence, whose growth rate is a degree-71 algebraic number he called lambda.',
  'Conway and Simon Norton wrote "Monstrous Moonshine" in 1979, connecting the largest sporadic simple group to a function from number theory nobody expected to meet it.',
  'Conway once described mathematics as the only subject where you can be certain you are right, and then be embarrassed about how long it took.',

  // ── Shannon ──
  'Claude Shannon estimated the number of plausible chess games at about 10^120. There are perhaps 10^80 atoms in the observable universe.',
  'Shannon built a mechanical mouse named Theseus in 1950 that learned its way through a maze. It is one of the first machine-learning devices.',
  'Shannon rode a unicycle down the halls of Bell Labs, sometimes while juggling.',
  'Shannon built a machine whose only function was to switch itself off. He called it the Ultimate Machine.',
  'Shannon wrote the first paper on programming a computer to play chess in 1950, and separated it into brute-force type A and selective type B strategies still argued about today.',
  'Shannon co-built a wearable computer for roulette with Ed Thorp, and separately proved the mathematics behind information itself.',
  'Shannon measured the entropy of written English at roughly one bit per letter by asking people to guess the next character.',

  // ── combinatorial game theory ──
  'Nim is solved by writing pile sizes in binary and XORing them. If the result is zero, the player to move loses.',
  'The Sprague–Grundy theorem says every impartial game is secretly a pile of Nim. All of them, without exception.',
  'Checkers was proved a draw in 2007 after eighteen years of computation. It remains the largest game ever solved exactly.',
  'Connect Four is a first-player win. Take the middle column.',
  'Hex can be proved a first-player win without anyone knowing the winning strategy, using a strategy-stealing argument.',
  'Nobody knows whether Go on a 19×19 board is a first-player win, and the strategy-stealing trick fails there because passing is legal.',
  'The number of legal Go positions was computed exactly in 2016. It has 171 digits.',
  'Tic-tac-toe has 255,168 possible games and all of them are boring.',
  'A game with loops needs a third answer beyond win and loss, which is why "draw" is a structural feature and not a consolation prize.',
  'Retrograde analysis, which is how every tablebase is built, works backwards from positions already over. You never search forwards at all.',
  'A distance-to-mate number is not advice. A move can be winning and still be the slowest way to win.',
  'Zugzwang, from the German for "compulsion to move", is a position where you would be better off passing. Most games do not allow it.',
  'The game of Sylver Coinage has positions where nobody knows who wins, and Conway offered money for one of them.',
  'Chomp is a first-player win for every rectangle bigger than 1×1, and for most of them nobody knows the winning move.',
  'Every finite game of perfect information has an optimal strategy. Zermelo proved it for chess in 1913, decades before anyone could use it.',

  // ── counting and probability ──
  'A deck of 52 cards can be ordered 52! ways, about 8 × 10^67. Every well-shuffled deck is almost certainly an order that has never existed.',
  'The Ramsey number R(5,5) is somewhere between 43 and 48. That is the whole of human knowledge on the subject.',
  'Erdős imagined a demon demanding R(5,5) or the destruction of Earth, and said we should marshal every computer. For R(6,6) he advised destroying the demon.',
  'Graham\'s number is so large it cannot be written in scientific notation, in a tower of exponents, or in the observable universe. Its last digit is 7.',
  'The birthday paradox needs only 23 people for a coin-flip chance that two share a birthday, because you are counting pairs, not people.',
  'In rock-paper-scissors between humans, rock is thrown slightly more than a third of the time. Against an optimal opponent it does not matter at all.',
  'The optimal strategy for rock-paper-scissors is to be perfectly random, which is also the one thing humans are worst at.',
  'A perfect mixed strategy cannot be beaten, but it cannot beat anything either. Winning requires your opponent to be predictable.',
  'Von Neumann proved the minimax theorem in 1928, giving every two-player zero-sum game a value long before anyone called it game theory.',
  'The Monty Hall problem fooled thousands of mathematicians, including Erdős, who reportedly stayed unconvinced until shown a simulation.',
]);

const STORE_KEY = 'janken-dyk';
const read = () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(STORE_KEY, v); } catch { /* optional */ } };

// Never the same fact twice in a row, including across a reload, which is the repeat a visitor
// actually notices. Beyond that, uniform choice is honest and needs no bookkeeping.
export function pickFact(facts = FACTS) {
  if (facts.length < 2) return facts[0] || '';
  const last = read();
  let fact = last;
  while (fact === last) fact = facts[(Math.random() * facts.length) | 0];
  write(fact);
  return fact;
}

// Types the fact out one character at a time, unless the visitor asked for less motion, in which
// case it simply appears. The caret is CSS; this only owns the text.
export function mountFact(el, { speed = 18 } = {}) {
  if (!el) return;
  const fact = pickFact();
  el.hidden = false;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) { el.textContent = fact; return; }
  el.textContent = '';
  el.classList.add('typing');
  let i = 0;
  const tick = () => {
    el.textContent = fact.slice(0, ++i);
    if (i < fact.length) setTimeout(tick, speed + (fact[i] === ' ' ? 0 : Math.random() * 22));
    else el.classList.remove('typing');
  };
  setTimeout(tick, 320);
}
