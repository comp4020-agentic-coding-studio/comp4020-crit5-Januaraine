import { describe, expect, it } from "vitest";
import {
  activateSpeedBoost,
  advanceGameTime,
  BALL_HEIGHT,
  BALL_WIDTH,
  CATCH_SKILL_THRESHOLD,
  catchTriggersSpeedBoost,
  createInitialPaddle,
  createInputState,
  createSmallBalls,
  deactivateSpeedBoost,
  INITIAL_SPEED_BOOST_STATE,
  MAX_BOUNCE_ANGLE,
  MAX_SPEED,
  MIN_SPEED,
  MIN_VERTICAL_RATIO,
  movePaddle,
  pushTrailEntry,
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
