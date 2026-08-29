import { describe, expect, it } from "vitest";
import {
  BALL_HEIGHT,
  BALL_WIDTH,
  createInitialPaddle,
  createInputState,
  movePaddle,
  resolvePaddleDelta,
  setInputKey,
  setInputPointer,
  stepBall,
  stepGame,
  togglePause,
  type Ball,
  type Bounds,
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
