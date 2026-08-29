import { describe, expect, it } from "vitest";
import {
  activateSpeedBoost,
  advanceGameTime,
  BALL_HEIGHT,
  BALL_WIDTH,
  CATCH_SKILL_THRESHOLD,
  catchTriggersSpeedBoost,
  cornerWinTolerance,
  createInitialPaddle,
  createInputState,
  createScoreState,
  createSmallBalls,
  deactivateSpeedBoost,
  INITIAL_SPEED_BOOST_STATE,
  MAX_BOUNCE_ANGLE,
  MAX_SPEED,
  MIN_SPEED,
  MIN_VERTICAL_RATIO,
  movePaddle,
  pushTrailEntry,
  recordCatch,
  recordWin,
  resetCatches,
  resolveBallCollisions,
  resolvePaddleDelta,
  setInputKey,
  setInputPointer,
  SMALL_BALL_SCALE,
  SPAWN_COLLISION_THRESHOLD,
  SPAWN_COUNT,
  speedBoostExpired,
  speedBoostRemainingMs,
  SPEED_BOOST_DURATION_MS,
  SPEED_BOOST_MULTIPLIER,
  stepBall,
  stepEntities,
  stepGame,
  togglePause,
  TRAIL_LENGTH,
  wallHitTriggersSpawn,
  type Ball,
  type Bounds,
  type TrailEntry,
} from "../src/scripts/dvd-game";

const bounds: Bounds = { w: 720, h: 480 };

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return {
    x: 200,
    y: 100,
    w: BALL_WIDTH,
    h: BALL_HEIGHT,
    vx: 100,
    vy: 100,
    color: "#39ff88",
    ...overrides,
  };
}

describe("stepBall: walls", () => {
  it("reflects vx off the left wall", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ x: 2, vx: -100 }), paddle, bounds, 0.1);
    expect(result.ball.vx).toBeGreaterThan(0);
    expect(result.ball.x).toBeGreaterThanOrEqual(0);
    expect(result.wallHit).toBe(true);
  });

  it("reflects vx off the right wall", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: bounds.w - BALL_WIDTH - 2, vx: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.ball.vx).toBeLessThan(0);
    expect(result.wallHit).toBe(true);
  });

  it("reflects vy off the top wall", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ y: 1, vy: -100 }), paddle, bounds, 0.1);
    expect(result.ball.vy).toBeGreaterThan(0);
    expect(result.wallHit).toBe(true);
  });

  it("flags a corner hit only when a side wall and the top wall are hit together", () => {
    const paddle = createInitialPaddle(bounds);
    const corner = stepBall(makeBall({ x: 1, y: 1, vx: -100, vy: -100 }), paddle, bounds, 0.1);
    expect(corner.cornerHit).toBe(true);

    const sideOnly = stepBall(makeBall({ x: 1, y: 100, vx: -100, vy: 0 }), paddle, bounds, 0.1);
    expect(sideOnly.cornerHit).toBe(false);
  });

  it("wins on a top-left corner hit, and again on a top-right corner hit", () => {
    const paddle = createInitialPaddle(bounds);

    const topLeft = stepBall(makeBall({ x: 1, y: 1, vx: -100, vy: -100 }), paddle, bounds, 0.1);
    expect(topLeft.win).toBe(true);

    const topRight = stepBall(
      makeBall({ x: bounds.w - BALL_WIDTH - 1, y: 1, vx: 100, vy: -100 }),
      paddle,
      bounds,
      0.1,
    );
    expect(topRight.win).toBe(true);
  });

  it("does not win on a side-only or top-only wall hit", () => {
    const paddle = createInitialPaddle(bounds);

    const sideOnly = stepBall(makeBall({ x: 1, y: 100, vx: -100, vy: 0 }), paddle, bounds, 0.1);
    expect(sideOnly.win).toBe(false);

    const topOnly = stepBall(makeBall({ x: 200, y: 1, vx: 0, vy: -100 }), paddle, bounds, 0.1);
    expect(topOnly.win).toBe(false);
  });

  it("wins when the logo is merely inside the corner win-zone tolerance, without touching either wall", () => {
    const paddle = createInitialPaddle(bounds);
    const tolerance = cornerWinTolerance(bounds);

    // Sitting just inside the top-left win zone, not touching x=0 or y=0.
    const nearTopLeft = stepBall(
      makeBall({ x: tolerance - 5, y: tolerance - 10, vx: 0, vy: 0 }),
      paddle,
      bounds,
      0.1,
    );
    expect(nearTopLeft.cornerHit).toBe(false);
    expect(nearTopLeft.wallHit).toBe(false);
    expect(nearTopLeft.win).toBe(true);

    // Sitting just inside the top-right win zone, not touching either wall.
    const nearTopRight = stepBall(
      makeBall({ x: bounds.w - BALL_WIDTH - (tolerance - 5), y: tolerance - 10, vx: 0, vy: 0 }),
      paddle,
      bounds,
      0.1,
    );
    expect(nearTopRight.cornerHit).toBe(false);
    expect(nearTopRight.wallHit).toBe(false);
    expect(nearTopRight.win).toBe(true);
  });

  it("does not win when the logo is clearly outside the corner win-zone tolerance", () => {
    const paddle = createInitialPaddle(bounds);
    const tolerance = cornerWinTolerance(bounds);

    // Well past the tolerance on both axes — nowhere near either top corner.
    const farFromCorner = stepBall(
      makeBall({ x: tolerance + 40, y: tolerance + 40, vx: 0, vy: 0 }),
      paddle,
      bounds,
      0.1,
    );
    expect(farFromCorner.win).toBe(false);

    // Close to the left wall but well below the top-edge tolerance band.
    const closeToLeftWallOnly = stepBall(
      makeBall({ x: 0, y: tolerance + 40, vx: 0, vy: 0 }),
      paddle,
      bounds,
      0.1,
    );
    expect(closeToLeftWallOnly.win).toBe(false);
  });
});

describe("stepBall: difficulty-specific corner win condition", () => {
  it("EASY: wins on an exact corner hit", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ x: 1, y: 1, vx: -100, vy: -100 }), paddle, bounds, 0.1, "easy");
    expect(result.win).toBe(true);
  });

  it("EASY: wins when merely inside the corner tolerance, without touching either wall", () => {
    const paddle = createInitialPaddle(bounds);
    const tolerance = cornerWinTolerance(bounds);
    const result = stepBall(
      makeBall({ x: tolerance - 5, y: tolerance - 10, vx: 0, vy: 0 }),
      paddle,
      bounds,
      0.1,
      "easy",
    );
    expect(result.cornerHit).toBe(false);
    expect(result.win).toBe(true);
  });

  it("HARD: wins on an exact corner hit", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ x: 1, y: 1, vx: -100, vy: -100 }), paddle, bounds, 0.1, "hard");
    expect(result.cornerHit).toBe(true);
    expect(result.win).toBe(true);
  });

  it("HARD: does not win when only inside the Easy tolerance, without actually reaching the corner", () => {
    const paddle = createInitialPaddle(bounds);
    const tolerance = cornerWinTolerance(bounds);
    const result = stepBall(
      makeBall({ x: tolerance - 5, y: tolerance - 10, vx: 0, vy: 0 }),
      paddle,
      bounds,
      0.1,
      "hard",
    );
    expect(result.cornerHit).toBe(false);
    expect(result.win).toBe(false);
  });

  it("neither mode wins on a normal wall collision away from a corner", () => {
    const paddle = createInitialPaddle(bounds);

    const easySide = stepBall(makeBall({ x: 1, y: 100, vx: -100, vy: 0 }), paddle, bounds, 0.1, "easy");
    expect(easySide.win).toBe(false);

    const hardSide = stepBall(makeBall({ x: 1, y: 100, vx: -100, vy: 0 }), paddle, bounds, 0.1, "hard");
    expect(hardSide.win).toBe(false);

    const easyTop = stepBall(makeBall({ x: 200, y: 1, vx: 0, vy: -100 }), paddle, bounds, 0.1, "easy");
    expect(easyTop.win).toBe(false);

    const hardTop = stepBall(makeBall({ x: 200, y: 1, vx: 0, vy: -100 }), paddle, bounds, 0.1, "hard");
    expect(hardTop.win).toBe(false);
  });

  it("switching difficulty changes the outcome for the exact same near-corner position", () => {
    const paddle = createInitialPaddle(bounds);
    const tolerance = cornerWinTolerance(bounds);
    const nearCornerBall = makeBall({ x: tolerance - 5, y: tolerance - 10, vx: 0, vy: 0 });

    const easyResult = stepBall(nearCornerBall, paddle, bounds, 0.1, "easy");
    const hardResult = stepBall(nearCornerBall, paddle, bounds, 0.1, "hard");

    expect(easyResult.win).toBe(true);
    expect(hardResult.win).toBe(false);
  });

  it("stepBall defaults to Easy's relaxed tolerance when no difficulty is given", () => {
    const paddle = createInitialPaddle(bounds);
    const tolerance = cornerWinTolerance(bounds);
    const result = stepBall(makeBall({ x: tolerance - 5, y: tolerance - 10, vx: 0, vy: 0 }), paddle, bounds, 0.1);
    expect(result.win).toBe(true);
  });

  it("catch counting is identical in both modes: a paddle bounce reports bounced regardless of difficulty", () => {
    const paddle = createInitialPaddle(bounds);
    const catchingBall = makeBall({
      x: paddle.x + paddle.w / 2 - BALL_WIDTH / 2,
      y: paddle.y - BALL_HEIGHT + 1,
      vx: 0,
      vy: 200,
    });

    const easyCatch = stepBall(catchingBall, paddle, bounds, 0.1, "easy");
    const hardCatch = stepBall(catchingBall, paddle, bounds, 0.1, "hard");

    expect(easyCatch.bounced).toBe(true);
    expect(hardCatch.bounced).toBe(true);

    const scoreAfterEasy = recordCatch(createScoreState(), easyCatch.bounced);
    const scoreAfterHard = recordCatch(createScoreState(), hardCatch.bounced);
    expect(scoreAfterEasy.catches).toBe(1);
    expect(scoreAfterHard.catches).toBe(1);
  });
});

describe("stepBall: paddle band", () => {
  it("bounces off the paddle when overlapping it while descending", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: paddle.x + paddle.w / 2 - BALL_WIDTH / 2, y: paddle.y - 5, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.bounced).toBe(true);
    expect(result.ball.vy).toBeLessThan(0);
    expect(result.gameOver).toBe(false);
  });

  it("ends the game when the ball clears the paddle's bottom edge without overlap", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y + paddle.h + 1, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.gameOver).toBe(true);
    expect(result.bounced).toBe(false);
  });

  it("does not end the game while the ball is still above the paddle band", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y - 100, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.gameOver).toBe(false);
    expect(result.bounced).toBe(false);
  });

  it("does not end the game while sliding past the paddle but still inside its band", () => {
    // A shorter ball than the paddle band, so "inside the band but not yet
    // past its bottom edge" is a reachable state to assert on.
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y + 1, h: 5, vy: 10 });
    const result = stepBall(ball, paddle, bounds, 0.01);
    expect(result.gameOver).toBe(false);
    expect(result.bounced).toBe(false);
  });
});

describe("stepBall: paddle bounce physics", () => {
  function catchAt(offset: number, vx: number, vy: number) {
    const paddle = createInitialPaddle(bounds);
    const paddleCenter = paddle.x + paddle.w / 2;
    const ballCenter = paddleCenter + offset * (paddle.w / 2);
    const ball = makeBall({ x: ballCenter - BALL_WIDTH / 2, y: paddle.y - 1, vx, vy });
    return { paddle, result: stepBall(ball, paddle, bounds, 0.1) };
  }

  it("sends a centre hit mostly/purely upward", () => {
    const { result } = catchAt(0, 0, 200);
    expect(result.bounced).toBe(true);
    expect(result.ball.vy).toBeLessThan(0);
    expect(result.ball.vx).toBeCloseTo(0, 5);
  });

  it("sends a left-edge hit diagonally up-left (negative vx, upward vy)", () => {
    const { result } = catchAt(-1, 50, 200);
    expect(result.ball.vx).toBeLessThan(0);
    expect(result.ball.vy).toBeLessThan(0);
  });

  it("sends a right-edge hit diagonally up-right (positive vx)", () => {
    const { result } = catchAt(1, -50, 200);
    expect(result.ball.vx).toBeGreaterThan(0);
    expect(result.ball.vy).toBeLessThan(0);
  });

  it("preserves the incoming speed (within the MIN/MAX_SPEED band) rather than losing or adding energy", () => {
    const incomingSpeed = Math.hypot(150, 200);
    const { result } = catchAt(0.3, 150, 200);
    expect(Math.hypot(result.ball.vx, result.ball.vy)).toBeCloseTo(incomingSpeed, 5);
  });

  it("never lets the outgoing vertical component collapse toward zero, even on an extreme edge hit", () => {
    const { result } = catchAt(1, 0, 500);
    const speed = Math.hypot(result.ball.vx, result.ball.vy);
    expect(Math.abs(result.ball.vy)).toBeGreaterThanOrEqual(speed * Math.cos(MAX_BOUNCE_ANGLE) - 1e-6);
  });

  it("never bounces the ball into an almost-horizontal trajectory, at any hit offset", () => {
    for (const offset of [-1, -0.5, 0, 0.5, 1]) {
      const { result } = catchAt(offset, 100, 300);
      const angleFromVertical = Math.atan2(Math.abs(result.ball.vx), Math.abs(result.ball.vy));
      expect(angleFromVertical).toBeLessThanOrEqual(MAX_BOUNCE_ANGLE + 1e-9);
    }
  });

  it("keeps speed bounded across many repeated catches, without growing unbounded or decaying toward zero", () => {
    const paddle = createInitialPaddle(bounds);
    let vx = 900;
    let vy = 900;
    for (let i = 0; i < 25; i++) {
      const offset = i % 2 === 0 ? -1 : 1;
      const paddleCenter = paddle.x + paddle.w / 2;
      const x = paddleCenter + offset * (paddle.w / 2) - BALL_WIDTH / 2;
      const ball = makeBall({ x, y: paddle.y - 1, vx, vy });
      const result = stepBall(ball, paddle, bounds, 0.1);
      vx = result.ball.vx;
      vy = result.ball.vy;
      const speed = Math.hypot(vx, vy);
      expect(speed).toBeGreaterThanOrEqual(MIN_SPEED - 1e-6);
      expect(speed).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
    }
  });
});

describe("stepGame: pause", () => {
  it("freezes the ball and suspends every collision/win/game-over check while paused", () => {
    const paddle = createInitialPaddle(bounds);
    // A ball that would otherwise win (top-left corner) this step.
    const ball = makeBall({ x: 1, y: 1, vx: -100, vy: -100 });
    const result = stepGame(ball, paddle, bounds, 0.1, true);

    expect(result.ball).toEqual(ball);
    expect(result.wallHit).toBe(false);
    expect(result.cornerHit).toBe(false);
    expect(result.win).toBe(false);
    expect(result.bounced).toBe(false);
    expect(result.gameOver).toBe(false);
  });

  it("also freezes a ball that would otherwise trigger game-over", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y + paddle.h + 1, vy: 100 });
    const result = stepGame(ball, paddle, bounds, 0.1, true);

    expect(result.ball).toEqual(ball);
    expect(result.gameOver).toBe(false);
  });

  it("behaves exactly like stepBall when not paused", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 1, y: 1, vx: -100, vy: -100 });

    expect(stepGame(ball, paddle, bounds, 0.1, false)).toEqual(stepBall(ball, paddle, bounds, 0.1));
  });
});

describe("togglePause", () => {
  it("toggles pause on and off while the game is running", () => {
    expect(togglePause(false, true)).toBe(true);
    expect(togglePause(true, true)).toBe(false);
  });

  it("is a no-op once the game has ended, so it can't revive a finished win/game-over state", () => {
    expect(togglePause(false, false)).toBe(false);
    expect(togglePause(true, false)).toBe(true);
  });
});

describe("pause menu: Continue/Restart contracts (main.ts wires Escape, KeyP, and the pause-menu buttons to these same pure functions)", () => {
  it("Escape or P pauses a running, unpaused game", () => {
    // main.ts routes both Escape and KeyP through this same togglePause call,
    // so a single pure-function assertion covers pausing via either key.
    expect(togglePause(false, true)).toBe(true);
  });

  it("Escape, P, or the Continue button resumes a paused game", () => {
    // main.ts's Continue button calls the exact same togglePause path as the
    // Escape/P keydown handler (see togglePauseState in main.ts).
    expect(togglePause(true, true)).toBe(false);
  });

  it("Continue preserves exact game state: pausing/resuming never touches the ball, paddle, or score, only the paused flag", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 111, y: 222, vx: -37, vy: 58 });
    let score = createScoreState();
    score = recordCatch(score, true);
    score = recordCatch(score, true);

    // Freeze while paused...
    const frozen = stepGame(ball, paddle, bounds, 0.1, true);
    expect(frozen.ball).toEqual(ball);

    // ...then "Continue" just flips the boolean — nothing else is derived
    // from it, so the ball/paddle/score a caller already holds are untouched.
    const resumed = togglePause(true, true);
    expect(resumed).toBe(false);
    expect(ball).toEqual({ x: 111, y: 222, w: BALL_WIDTH, h: BALL_HEIGHT, vx: -37, vy: 58, color: "#39ff88" });
    expect(paddle).toEqual(createInitialPaddle(bounds));
    expect(score.catches).toBe(2);
  });

  it("Restart resets catches to 0 while preserving the session best (Restart and Change Mode both reset via resetCatches, never touching best)", () => {
    let score = createScoreState();
    for (let i = 0; i < 7; i++) score = recordCatch(score, true);
    score = recordWin(score); // best becomes 7

    const restarted = resetCatches(score);
    expect(restarted.catches).toBe(0);
    expect(restarted.best).toBe(7);
  });

  it("Change Mode's fresh game (same resetCatches path as Restart) also leaves the session best untouched", () => {
    let score = createScoreState();
    for (let i = 0; i < 4; i++) score = recordCatch(score, true);
    score = recordWin(score); // best becomes 4

    // main.ts's goToModeSelect -> startGame(newMode) -> reset() calls the
    // exact same resetCatches as an in-place Restart.
    const freshGame = resetCatches(score);
    expect(freshGame.catches).toBe(0);
    expect(freshGame.best).toBe(4);
  });
});

describe("win screen: Play Again/Change Mode contracts (main.ts wires #restart-win to reset() and #win-change-mode to the same goToModeSelect() the pause menu uses)", () => {
  it("Play Again resets catches to 0 while preserving the session best (reset() calls resetCatches, never touching best)", () => {
    let score = createScoreState();
    for (let i = 0; i < 5; i++) score = recordCatch(score, true);
    score = recordWin(score); // best becomes 5

    const playedAgain = resetCatches(score);
    expect(playedAgain.catches).toBe(0);
    expect(playedAgain.best).toBe(5);
  });

  it("Play Again's fresh game keeps the currently selected difficulty (reset() never touches difficulty; only startGame does)", () => {
    // main.ts's reset() has no difficulty parameter at all — it only resets
    // ball/paddle/score/timers, so whichever `difficulty` was locked in by
    // the mode-select screen simply carries over untouched into the new game.
    let score = createScoreState();
    score = recordCatch(score, true);
    score = recordWin(score);
    const afterPlayAgain = resetCatches(score);
    expect(afterPlayAgain.catches).toBe(0);
  });

  it("Change Mode's fresh game (same resetCatches path as Play Again) also leaves the session best untouched", () => {
    let score = createScoreState();
    for (let i = 0; i < 6; i++) score = recordCatch(score, true);
    score = recordWin(score); // best becomes 6

    // main.ts's #win-change-mode button calls the exact same goToModeSelect
    // -> startGame(newMode) -> reset() chain as the pause menu's Change Mode,
    // which resets via resetCatches — never touching best.
    const freshGame = resetCatches(score);
    expect(freshGame.catches).toBe(0);
    expect(freshGame.best).toBe(6);
  });

  it("switching difficulty from the win screen does not carry over the old game's catches into the new one", () => {
    let score = createScoreState();
    for (let i = 0; i < 8; i++) score = recordCatch(score, true);
    score = recordWin(score); // best becomes 8, catches still 8 until reset

    const newDifficultyGame = resetCatches(score);
    expect(newDifficultyGame.catches).toBe(0);
  });

  it("the final catch count a winning game reports is exactly what was accumulated, so the Win screen's CATCHES readout reflects it before any reset runs", () => {
    // main.ts sets winCatchesEl.textContent = String(score.catches) at the
    // moment main.win fires, strictly before Play Again/Change Mode ever
    // call resetCatches — so the displayed count is this exact value.
    let score = createScoreState();
    for (let i = 0; i < 10; i++) score = recordCatch(score, true);
    score = recordWin(score);
    expect(score.catches).toBe(10);
  });
});

describe("R restart shortcut (main.ts routes KeyR to the same reset() as the Restart/Play Again buttons, in every game state)", () => {
  it("restarts during active gameplay: resets catches to 0 while preserving the session best", () => {
    let score = createScoreState();
    score = recordCatch(score, true);
    score = recordCatch(score, true);
    score = recordWin(score); // best becomes 2

    // main.ts's KeyR handler calls reset() -> resetCatches(score), the exact
    // same path as every other restart trigger.
    const afterR = resetCatches(score);
    expect(afterR.catches).toBe(0);
    expect(afterR.best).toBe(2);
  });

  it("restarts while paused: reset() unconditionally sets paused back to false, so R also closes the pause menu", () => {
    // main.ts's reset() sets `paused = false` and hides pauseOverlay
    // regardless of the paused flag's value beforehand, so pressing R while
    // paused both closes the pause menu and starts the new game in one step.
    let score = createScoreState();
    score = recordCatch(score, true);
    score = recordWin(score); // best becomes 1

    const frozen = stepGame(makeBall(), createInitialPaddle(bounds), bounds, 0.1, true);
    expect(frozen.ball).toEqual(makeBall());

    const afterR = resetCatches(score);
    expect(afterR.catches).toBe(0);
    expect(afterR.best).toBe(1);
  });

  it("restarts after a Win, starting a new game in the same difficulty without touching best", () => {
    let score = createScoreState();
    for (let i = 0; i < 15; i++) score = recordCatch(score, true);
    score = recordWin(score); // best becomes 15

    // reset() has no difficulty parameter — it never touches `difficulty`,
    // so whichever mode was chosen on mode-select simply carries over.
    const afterR = resetCatches(score);
    expect(afterR.catches).toBe(0);
    expect(afterR.best).toBe(15);
  });

  it("restarts after a Game Over, starting a new game in the same difficulty without touching best", () => {
    let score = createScoreState();
    for (let i = 0; i < 3; i++) score = recordCatch(score, true);
    // Game over never calls recordWin, so best stays whatever it already was.
    score = recordWin(score); // best becomes 3, simulating an earlier win this session
    score = resetCatches(score);
    for (let i = 0; i < 2; i++) score = recordCatch(score, true);
    // Now simulate a game-over (no recordWin call) followed by an R restart.
    const afterR = resetCatches(score);
    expect(afterR.catches).toBe(0);
    expect(afterR.best).toBe(3);
  });

  it("R's restart resets the ball and paddle to their initial state, just like every other restart path", () => {
    // reset() rebuilds the ball via createInitialBall/createInitialPaddle
    // exactly as the mode-select/Restart/Play Again paths already do; this
    // asserts the initial paddle position those all converge on.
    const paddle = createInitialPaddle(bounds);
    expect(paddle.x).toBeGreaterThanOrEqual(0);
    expect(paddle.x + paddle.w).toBeLessThanOrEqual(bounds.w);
  });

  it("P/Esc pause behaviour is unaffected by the new R shortcut: togglePause still toggles independently", () => {
    expect(togglePause(false, true)).toBe(true);
    expect(togglePause(true, true)).toBe(false);
    expect(togglePause(false, false)).toBe(false);
    expect(togglePause(true, false)).toBe(true);
  });
});

describe("movePaddle", () => {
  it("clamps to the left edge", () => {
    const paddle = createInitialPaddle(bounds);
    expect(movePaddle(paddle, -10000, bounds).x).toBe(0);
  });

  it("clamps to the right edge", () => {
    const paddle = createInitialPaddle(bounds);
    expect(movePaddle(paddle, 10000, bounds).x).toBe(bounds.w - paddle.w);
  });
});

describe("catchTriggersSpeedBoost: catch-count speed-boost skill", () => {
  it("is false before the first threshold", () => {
    for (let n = 0; n < CATCH_SKILL_THRESHOLD; n++) {
      expect(catchTriggersSpeedBoost(n)).toBe(false);
    }
  });

  it("fires on every multiple of the threshold, cumulatively", () => {
    expect(catchTriggersSpeedBoost(CATCH_SKILL_THRESHOLD)).toBe(true);
    expect(catchTriggersSpeedBoost(CATCH_SKILL_THRESHOLD * 2)).toBe(true);
    expect(catchTriggersSpeedBoost(CATCH_SKILL_THRESHOLD * 3)).toBe(true);
  });

  it("is false between thresholds", () => {
    expect(catchTriggersSpeedBoost(CATCH_SKILL_THRESHOLD + 1)).toBe(false);
    expect(catchTriggersSpeedBoost(CATCH_SKILL_THRESHOLD * 2 - 1)).toBe(false);
  });
});

describe("wallHitTriggersSpawn: collision-count logo spawning", () => {
  it("is false before the first threshold", () => {
    for (let n = 0; n < SPAWN_COLLISION_THRESHOLD; n++) {
      expect(wallHitTriggersSpawn(n)).toBe(false);
    }
  });

  it("fires on every multiple of the threshold, cumulatively", () => {
    expect(wallHitTriggersSpawn(SPAWN_COLLISION_THRESHOLD)).toBe(true);
    expect(wallHitTriggersSpawn(SPAWN_COLLISION_THRESHOLD * 2)).toBe(true);
  });

  it("is false between thresholds", () => {
    expect(wallHitTriggersSpawn(SPAWN_COLLISION_THRESHOLD + 1)).toBe(false);
  });
});

describe("createSmallBalls", () => {
  const main: Ball = {
    x: 300,
    y: 200,
    w: BALL_WIDTH,
    h: BALL_HEIGHT,
    vx: 210,
    vy: 180,
    color: "#39ff88",
  };

  it("spawns SPAWN_COUNT small logos, scaled down and flagged as small", () => {
    const spawned = createSmallBalls(main, bounds);
    expect(spawned).toHaveLength(SPAWN_COUNT);
    for (const logo of spawned) {
      expect(logo.kind).toBe("small");
      expect(logo.w).toBeCloseTo(main.w * SMALL_BALL_SCALE);
      expect(logo.h).toBeCloseTo(main.h * SMALL_BALL_SCALE);
    }
  });

  it("launches each small logo at the main logo's current speed, in a distinct direction", () => {
    const speed = Math.hypot(main.vx, main.vy);
    const spawned = createSmallBalls(main, bounds);
    for (const logo of spawned) {
      expect(Math.hypot(logo.vx, logo.vy)).toBeCloseTo(speed);
    }
    const angles = new Set(spawned.map((logo) => Math.atan2(logo.vy, logo.vx).toFixed(3)));
    expect(angles.size).toBe(SPAWN_COUNT);
  });

  it("keeps every spawned logo within bounds", () => {
    const spawned = createSmallBalls(main, bounds);
    for (const logo of spawned) {
      expect(logo.x).toBeGreaterThanOrEqual(0);
      expect(logo.y).toBeGreaterThanOrEqual(0);
      expect(logo.x + logo.w).toBeLessThanOrEqual(bounds.w);
      expect(logo.y + logo.h).toBeLessThanOrEqual(bounds.h);
    }
  });
});

describe("resolveBallCollisions", () => {
  it("leaves non-overlapping logos untouched", () => {
    const a = { x: 0, y: 0, w: 20, h: 20, vx: 10, vy: 0, color: "#fff" };
    const b = { x: 200, y: 200, w: 20, h: 20, vx: -10, vy: 0, color: "#fff" };
    const [ra, rb] = resolveBallCollisions([a, b]);
    expect(ra).toEqual(a);
    expect(rb).toEqual(b);
  });

  it("swaps velocity along the axis of least penetration and separates overlapping logos", () => {
    // Overlap only on x: a's right edge pokes 4px into b's left edge.
    // Speeds are chosen inside [MIN_SPEED, MAX_SPEED] with a healthy vertical
    // share so the post-swap safety clamp is a no-op here — this test is
    // only about the swap/separation mechanics.
    const a = { x: 0, y: 0, w: 20, h: 20, vx: 150, vy: 200, color: "#fff" };
    const b = { x: 16, y: 0, w: 20, h: 20, vx: -150, vy: 200, color: "#fff" };
    const [ra, rb] = resolveBallCollisions([a, b]);

    expect(ra.vx).toBe(-150);
    expect(rb.vx).toBe(150);
    expect(ra.vy).toBe(200);
    expect(rb.vy).toBe(200);
    // Pushed apart so they no longer overlap.
    expect(ra.x + ra.w).toBeLessThanOrEqual(rb.x);
  });

  it("boosts a logo that would come out of a collision far too slow up to MIN_SPEED", () => {
    // a's vx is swapped away almost entirely, and its untouched vy is tiny —
    // without the post-swap clamp this logo would crawl at ~sqrt(1^2+2^2).
    const a = { x: 0, y: 0, w: 20, h: 20, vx: 1, vy: 2, color: "#fff" };
    const b = { x: 16, y: 0, w: 20, h: 20, vx: 50, vy: 300, color: "#fff" };
    const [ra] = resolveBallCollisions([a, b]);
    expect(Math.hypot(ra.vx, ra.vy)).toBeGreaterThanOrEqual(MIN_SPEED - 1e-6);
  });

  it("caps a logo that would come out of a collision far too fast down to MAX_SPEED", () => {
    // Overlap is smaller on x than y, so vx swaps: a inherits b's vx=900
    // while keeping its own vy=900, which would otherwise be ~1273px/s.
    const a = { x: 0, y: 0, w: 20, h: 20, vx: 10, vy: 900, color: "#fff" };
    const b = { x: 16, y: 0, w: 20, h: 20, vx: 900, vy: 20, color: "#fff" };
    const [ra] = resolveBallCollisions([a, b]);
    expect(Math.hypot(ra.vx, ra.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
  });

  it("never leaves a logo on a near-horizontal path after a collision swaps its vertical speed away", () => {
    // b's vy is swapped for a's near-zero vy, which would otherwise leave b
    // almost purely horizontal (vx=400, vy~0) and unable to come back down.
    const a = { x: 0, y: 16, w: 20, h: 20, vx: 100, vy: 1, color: "#fff" };
    const b = { x: 0, y: 0, w: 20, h: 20, vx: 400, vy: 250, color: "#fff" };
    const [, rb] = resolveBallCollisions([a, b]);
    const speed = Math.hypot(rb.vx, rb.vy);
    expect(Math.abs(rb.vy)).toBeGreaterThanOrEqual(speed * MIN_VERTICAL_RATIO - 1e-6);
  });
});

describe("stepEntities: multi-logo stepping", () => {
  const makeMain = (overrides: Partial<Ball> = {}): Ball => ({
    x: 0,
    y: 0,
    w: BALL_WIDTH,
    h: BALL_HEIGHT,
    vx: 100,
    vy: 100,
    color: "#39ff88",
    ...overrides,
  });

  it("freezes every logo and suspends all checks while paused", () => {
    const paddle = createInitialPaddle(bounds);
    const main = makeMain({ x: 1, y: 1, vx: -100, vy: -100 });
    const small: Ball = { x: 500, y: 5, w: 10, h: 10, vx: -50, vy: -50, color: "#fff", kind: "small" };
    const result = stepEntities([main, small], paddle, bounds, 0.1, true);

    expect(result.balls).toEqual([main, small]);
    expect(result.main.ball).toEqual(main);
    expect(result.main.win).toBe(false);
    expect(result.main.gameOver).toBe(false);
  });

  it("only the main logo's outcome can end or win the game, even if a small logo hits a corner", () => {
    const paddle = createInitialPaddle(bounds);
    // Main logo far from any wall this step.
    const main = makeMain({ x: 300, y: 200, vx: 0, vy: 0 });
    // Small logo heading straight into the top-left corner.
    const small: Ball = { x: 1, y: 1, w: 10, h: 10, vx: -100, vy: -100, color: "#fff", kind: "small" };
    const result = stepEntities([main, small], paddle, bounds, 0.1, false);

    expect(result.main.win).toBe(false);
    expect(result.main.gameOver).toBe(false);
  });

  it("drops a small logo that clears the paddle uncaught, without ending the game", () => {
    const paddle = createInitialPaddle(bounds);
    const main = makeMain({ x: 300, y: 200, vx: 0, vy: 0 });
    const small: Ball = {
      x: 0,
      y: paddle.y + paddle.h + 1,
      w: 10,
      h: 10,
      vx: 0,
      vy: 100,
      color: "#fff",
      kind: "small",
    };
    const result = stepEntities([main, small], paddle, bounds, 0.1, false);

    expect(result.balls).toHaveLength(1);
    expect(result.balls[0]!.kind).not.toBe("small");
    expect(result.main.gameOver).toBe(false);
  });

  it("reports a wallHit for each logo that bounced off a wall this step, main and small alike", () => {
    const paddle = createInitialPaddle(bounds);
    const main = makeMain({ x: 300, y: 200, vx: 0, vy: 0 });
    const small: Ball = { x: 2, y: 200, w: 10, h: 10, vx: -100, vy: 0, color: "#fff", kind: "small" };
    const result = stepEntities([main, small], paddle, bounds, 0.1, false);

    expect(result.wallHits).toHaveLength(2);
    expect(result.wallHits[0]).toBe(false);
    expect(result.wallHits[1]).toBe(true);
  });

  it("reports a collision for both logos when they overlap each other, not for one that stays clear", () => {
    const paddle = createInitialPaddle(bounds);
    const main = makeMain({ x: 300, y: 300, vx: 0, vy: 0 });
    const small: Ball = { x: 305, y: 300, w: 20, h: 20, vx: 0, vy: 0, color: "#fff", kind: "small" };
    const clear: Ball = { x: 0, y: 0, w: 10, h: 10, vx: 0, vy: 0, color: "#fff", kind: "small" };
    const result = stepEntities([main, small, clear], paddle, bounds, 0.1, false);

    expect(result.collisions).toEqual([true, true, false]);
  });

  it("still ends the game when the main logo (not a small one) clears the paddle uncaught", () => {
    const paddle = createInitialPaddle(bounds);
    const main = makeMain({ x: 0, y: paddle.y + paddle.h + 1, vy: 100 });
    const result = stepEntities([main], paddle, bounds, 0.1, false);

    expect(result.main.gameOver).toBe(true);
  });
});

describe("input state: keyboard/mouse independence", () => {
  // Regression test for a bug where, once the mouse had ever been used, the
  // pointer's last (now stale) position kept being re-applied every frame
  // and silently overrode keyboard movement — keyboard appeared "dead" after
  // any mouse use. Keyboard and mouse must remain independent input methods:
  // whichever was used most recently drives the paddle.
  const paddle = createInitialPaddle(bounds);
  const speed = 390;
  const dt = 0.1;

  it("does not move the paddle before any input has been received", () => {
    const state = createInputState();
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBe(0);
  });

  it("moves the paddle from keyboard input alone", () => {
    let state = createInputState();
    state = setInputKey(state, "right", true);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(speed * dt);
  });

  it("moves the paddle to follow the pointer once the mouse has been used", () => {
    let state = createInputState();
    state = setInputPointer(state, paddle.x + paddle.w / 2 + 50);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(50);
  });

  it("regains keyboard control immediately after mouse use (keyboard -> mouse -> keyboard)", () => {
    let state = createInputState();

    // Keyboard first: works on its own.
    state = setInputKey(state, "right", true);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(speed * dt);
    state = setInputKey(state, "right", false);

    // Switch to mouse: pointer now drives the paddle.
    state = setInputPointer(state, paddle.x + paddle.w / 2 + 50);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(50);

    // Switch back to keyboard: pressing a move key must regain control even
    // though the stale pointer position is still stored in state.
    state = setInputKey(state, "left", true);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(-speed * dt);
  });

  it("hands control back to mouse after keyboard (mouse -> keyboard -> mouse)", () => {
    let state = createInputState();

    state = setInputPointer(state, paddle.x + paddle.w / 2 + 20);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(20);

    state = setInputKey(state, "left", true);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(-speed * dt);
    state = setInputKey(state, "left", false);

    state = setInputPointer(state, paddle.x + paddle.w / 2 - 30);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(-30);
  });

  it("supports repeated switching: keyboard -> mouse -> keyboard -> mouse", () => {
    let state = createInputState();

    state = setInputKey(state, "right", true);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeGreaterThan(0);

    state = setInputPointer(state, paddle.x + paddle.w / 2 + 10);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(10);

    state = setInputKey(state, "right", false);
    state = setInputKey(state, "left", true);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeLessThan(0);

    state = setInputPointer(state, paddle.x + paddle.w / 2 - 10);
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBeCloseTo(-10);
  });

  it("releasing a key does not hand control back to a stale pointer position", () => {
    let state = createInputState();
    state = setInputPointer(state, paddle.x + paddle.w / 2 + 40);
    state = setInputKey(state, "right", true);
    state = setInputKey(state, "right", false);
    // No move key is held and keyboard is still the active source, so there
    // should be no movement — not a snap back to the old pointer position.
    expect(resolvePaddleDelta(state, paddle, speed, dt)).toBe(0);
  });
});

describe("speed-boost countdown state", () => {
  it("starts at the full boost duration the instant the boost starts", () => {
    const state = activateSpeedBoost(1000);
    expect(state.active).toBe(true);
    expect(speedBoostRemainingMs(state, 1000)).toBe(SPEED_BOOST_DURATION_MS);
  });

  it("decreases in lockstep with elapsed game time, using the real boost duration", () => {
    const state = activateSpeedBoost(1000);
    expect(speedBoostRemainingMs(state, 1000 + 1000)).toBe(SPEED_BOOST_DURATION_MS - 1000);
    expect(speedBoostRemainingMs(state, 1000 + 2500)).toBe(SPEED_BOOST_DURATION_MS - 2500);
    expect(speedBoostRemainingMs(state, 1000 + SPEED_BOOST_DURATION_MS)).toBe(0);
  });

  it("reports 0 remaining whenever inactive, regardless of `now`", () => {
    expect(speedBoostRemainingMs(INITIAL_SPEED_BOOST_STATE, 999999)).toBe(0);
  });

  it("is not expired before its end time, and expired at/after it", () => {
    const state = activateSpeedBoost(0);
    expect(speedBoostExpired(state, SPEED_BOOST_DURATION_MS - 1)).toBe(false);
    expect(speedBoostExpired(state, SPEED_BOOST_DURATION_MS)).toBe(true);
    expect(speedBoostExpired(state, SPEED_BOOST_DURATION_MS + 500)).toBe(true);
  });

  it("never reports expired while inactive", () => {
    expect(speedBoostExpired(INITIAL_SPEED_BOOST_STATE, 999999)).toBe(false);
  });

  it("disappears (remaining becomes 0) once deactivated after expiry", () => {
    const expired = deactivateSpeedBoost(activateSpeedBoost(0));
    expect(expired.active).toBe(false);
    expect(speedBoostRemainingMs(expired, SPEED_BOOST_DURATION_MS)).toBe(0);
  });
});

describe("advanceGameTime: pause freezes the boost clock", () => {
  it("advances by dt while unpaused", () => {
    expect(advanceGameTime(1000, 0.1, false)).toBe(1100);
  });

  it("does not advance at all while paused", () => {
    expect(advanceGameTime(1000, 0.1, true)).toBe(1000);
  });

  it("stays frozen across many paused ticks, then resumes exactly where it left off", () => {
    let gameTime = 500;
    for (let i = 0; i < 10; i++) gameTime = advanceGameTime(gameTime, 0.016, true);
    expect(gameTime).toBe(500);

    gameTime = advanceGameTime(gameTime, 0.016, false);
    expect(gameTime).toBeCloseTo(516, 5);
  });

  it("keeps the boost countdown static while the game-time clock it reads is paused", () => {
    let gameTime = 0;
    const boost = activateSpeedBoost(gameTime);
    const remainingBeforePause = speedBoostRemainingMs(boost, gameTime);

    for (let i = 0; i < 5; i++) {
      gameTime = advanceGameTime(gameTime, 0.1, true);
      expect(speedBoostRemainingMs(boost, gameTime)).toBe(remainingBeforePause);
    }
  });
});

describe("motion trail: visual-only afterimages", () => {
  function makeEntry(overrides: Partial<TrailEntry> = {}): TrailEntry {
    return { x: 10, y: 20, color: "#39ff88", scale: 1, ...overrides };
  }

  it("carries only x/y/color/scale — no w/h/vx/vy, so it can never be treated as a Rect/Ball for collisions", () => {
    const entry = makeEntry();
    const asBag = entry as unknown as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(["color", "scale", "x", "y"]);
    expect(asBag["w"]).toBeUndefined();
    expect(asBag["h"]).toBeUndefined();
    expect(asBag["vx"]).toBeUndefined();
    expect(asBag["vy"]).toBeUndefined();
  });

  it("prepends the newest entry to the front of the trail", () => {
    const trail = pushTrailEntry([makeEntry({ x: 1 })], makeEntry({ x: 2 }));
    expect(trail[0]).toEqual(makeEntry({ x: 2 }));
    expect(trail[1]).toEqual(makeEntry({ x: 1 }));
  });

  it("caps the trail at a small fixed length (TRAIL_LENGTH), reusing the array instead of growing unbounded", () => {
    let trail: TrailEntry[] = [];
    for (let i = 0; i < 50; i++) {
      trail = pushTrailEntry(trail, makeEntry({ x: i }));
      expect(trail.length).toBeLessThanOrEqual(TRAIL_LENGTH);
    }
    expect(trail.length).toBe(TRAIL_LENGTH);
    // Most recently pushed entry (x: 49) is still the most recent (front).
    expect(trail[0]!.x).toBe(49);
  });

  it("respects a custom max length", () => {
    let trail: TrailEntry[] = [];
    for (let i = 0; i < 10; i++) trail = pushTrailEntry(trail, makeEntry({ x: i }), 3);
    expect(trail.length).toBe(3);
  });

  it("carries whichever scale the producing logo was drawn at, so a small logo's afterimage matches its own size", () => {
    const trail = pushTrailEntry([], makeEntry({ scale: 0.5 }));
    expect(trail[0]!.scale).toBe(0.5);
  });
});

describe("speed-boost visual feedback: existing boost behaviour is unchanged", () => {
  it("keeps the existing multiplier and duration constants exactly as before", () => {
    expect(SPEED_BOOST_MULTIPLIER).toBe(1.7);
    expect(SPEED_BOOST_DURATION_MS).toBe(5000);
  });

  it("keeps the existing catch-count trigger rule (every 5th cumulative catch)", () => {
    expect(catchTriggersSpeedBoost(CATCH_SKILL_THRESHOLD)).toBe(true);
    expect(catchTriggersSpeedBoost(CATCH_SKILL_THRESHOLD - 1)).toBe(false);
  });

  it("still preserves incoming speed on a paddle catch while boosted-magnitude velocities are in play", () => {
    // Regression check that the paddle-bounce physics (independent of the
    // new boost-state/trail code) is untouched: a catch at boosted speed
    // still reflects elastically within [MIN_SPEED, MAX_SPEED].
    const paddle = createInitialPaddle(bounds);
    const boostedSpeed = Math.hypot(210, 180) * SPEED_BOOST_MULTIPLIER;
    const ball: Ball = {
      x: paddle.x + paddle.w / 2 - BALL_WIDTH / 2,
      y: paddle.y - 1,
      w: BALL_WIDTH,
      h: BALL_HEIGHT,
      vx: 0,
      vy: boostedSpeed,
      color: "#39ff88",
    };
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.bounced).toBe(true);
    const outgoingSpeed = Math.hypot(result.ball.vx, result.ball.vy);
    expect(outgoingSpeed).toBeGreaterThanOrEqual(MIN_SPEED - 1e-6);
    expect(outgoingSpeed).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
  });
});

describe("Normal Mode score: catches + session-only best", () => {
  it("best starts empty (null) on a fresh score state", () => {
    const score = createScoreState();
    expect(score.catches).toBe(0);
    expect(score.best).toBeNull();
  });

  it("a paddle collision (bounced) increments catches by exactly 1", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: paddle.x + paddle.w / 2 - BALL_WIDTH / 2, y: paddle.y - 5, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.bounced).toBe(true);

    const before = createScoreState();
    const after = recordCatch(before, result.bounced);
    expect(after.catches).toBe(1);
  });

  it("a wall collision alone does not increment catches", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ x: 2, vx: -100 }), paddle, bounds, 0.1);
    expect(result.wallHit).toBe(true);
    expect(result.bounced).toBe(false);

    const score = recordCatch(createScoreState(), result.bounced);
    expect(score.catches).toBe(0);
  });

  it("a corner collision does not increment catches by itself", () => {
    const paddle = createInitialPaddle(bounds);
    const result = stepBall(makeBall({ x: 1, y: 1, vx: -100, vy: -100 }), paddle, bounds, 0.1);
    expect(result.cornerHit).toBe(true);
    expect(result.win).toBe(true);
    expect(result.bounced).toBe(false);

    const score = recordCatch(createScoreState(), result.bounced);
    expect(score.catches).toBe(0);
  });

  it("missing the paddle (game over) does not increment catches", () => {
    const paddle = createInitialPaddle(bounds);
    const ball = makeBall({ x: 0, y: paddle.y + paddle.h + 1, vy: 100 });
    const result = stepBall(ball, paddle, bounds, 0.1);
    expect(result.gameOver).toBe(true);
    expect(result.bounced).toBe(false);

    const score = recordCatch(createScoreState(), result.bounced);
    expect(score.catches).toBe(0);
  });

  it("pausing does not change catches: a frozen step never reports bounced, so the count can't move", () => {
    const paddle = createInitialPaddle(bounds);
    // A ball positioned to catch on the paddle if it were allowed to step.
    const ball = makeBall({ x: paddle.x + paddle.w / 2 - BALL_WIDTH / 2, y: paddle.y - 5, vy: 100 });
    const result = stepGame(ball, paddle, bounds, 0.1, true);
    expect(result.bounced).toBe(false);

    let score = createScoreState();
    score = recordCatch(score, true); // simulate a prior catch this run
    const before = score.catches;
    score = recordCatch(score, result.bounced);
    expect(score.catches).toBe(before);
  });

  it("restart resets catches to 0", () => {
    let score = createScoreState();
    score = recordCatch(score, true);
    score = recordCatch(score, true);
    expect(score.catches).toBe(2);

    score = resetCatches(score);
    expect(score.catches).toBe(0);
  });

  it("restart does not reset the session best", () => {
    let score = createScoreState();
    score = recordCatch(score, true);
    score = recordCatch(score, true);
    score = recordWin(score); // best becomes 2

    score = resetCatches(score);
    expect(score.best).toBe(2);
    expect(score.catches).toBe(0);
  });

  it("a winning game updates best when its catch count is lower", () => {
    let score = createScoreState();
    for (let i = 0; i < 12; i++) score = recordCatch(score, true);
    score = recordWin(score);
    expect(score.best).toBe(12);

    score = resetCatches(score);
    for (let i = 0; i < 9; i++) score = recordCatch(score, true);
    score = recordWin(score);
    expect(score.best).toBe(9);
  });

  it("a winning game does not update best when its catch count is higher", () => {
    let score = createScoreState();
    for (let i = 0; i < 9; i++) score = recordCatch(score, true);
    score = recordWin(score);
    expect(score.best).toBe(9);

    score = resetCatches(score);
    for (let i = 0; i < 14; i++) score = recordCatch(score, true);
    score = recordWin(score);
    expect(score.best).toBe(9);
  });

  it("game over does not update best", () => {
    let score = createScoreState();
    for (let i = 0; i < 11; i++) score = recordCatch(score, true);
    // No recordWin call on game over.
    expect(score.best).toBeNull();
    expect(score.catches).toBe(11);
  });
});
