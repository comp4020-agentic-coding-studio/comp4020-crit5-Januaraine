import {
  BALL_HEIGHT,
  BALL_WIDTH,
  createInitialBall,
  createInitialPaddle,
  createInputState,
  movePaddle,
  resolvePaddleDelta,
  setInputKey,
  setInputPointer,
  stepGame,
  togglePause,
  type Ball,
  type InputState,
  type Paddle,
} from "./dvd-game";

const WORDMARK_TEXT = "DVD";
const WORDMARK_FONT_SIZE = Math.round(BALL_HEIGHT * 1.1);

interface WordmarkBox {
  w: number;
  h: number;
  /** Offset from the collision box's top-left corner to the fillText anchor. */
  offsetX: number;
  offsetY: number;
}

/**
 * Measures the actual rendered ink of the wordmark (not its font em-box) so
 * the collision rect can match the visible letters instead of the font's
 * generous line-height/advance-width padding.
 */
function measureWordmark(ctx: CanvasRenderingContext2D): WordmarkBox {
  ctx.font = `italic bold ${WORDMARK_FONT_SIZE}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(WORDMARK_TEXT);

  const left = metrics.actualBoundingBoxLeft ?? 0;
  const right = metrics.actualBoundingBoxRight ?? 0;
  const ascent = metrics.actualBoundingBoxAscent ?? 0;
  const descent = metrics.actualBoundingBoxDescent ?? 0;
  const w = left + right;
  const h = ascent + descent;

  if (w <= 0 || h <= 0) {
    // actualBoundingBox* unsupported: fall back to the legacy fixed box.
    return { w: BALL_WIDTH, h: BALL_HEIGHT, offsetX: BALL_WIDTH / 2, offsetY: BALL_HEIGHT / 2 };
  }
  return { w, h, offsetX: left, offsetY: ascent };
}

function initGame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  overlay: HTMLDivElement,
  restartButton: HTMLButtonElement,
  winOverlay: HTMLDivElement,
  restartWinButton: HTMLButtonElement,
  pauseOverlay: HTMLDivElement,
): void {
  ctx.imageSmoothingEnabled = false;

  const bounds = { w: canvas.width, h: canvas.height };
  const PADDLE_SPEED = 390; // px/s
  const COLORS = ["#39ff88", "#ff4d6d", "#ffd93d", "#4dd2ff", "#c77dff"];
  const MOVE_KEYS = new Set(["KeyA", "KeyD", "ArrowLeft", "ArrowRight", "Space"]);

  // Text/font never change at runtime, so the ink bounding box is measured
  // once and reused as the collision size for every ball created below.
  const wordmark = measureWordmark(ctx);

  let ball: Ball = createInitialBall(bounds, wordmark);
  let paddle: Paddle = createInitialPaddle(bounds);
  let colorIndex = 0;
  let running = true;
  let paused = false;
  let flashUntil = 0;
  let lastTime = performance.now();
  let input: InputState = createInputState();

  function pointerToCanvasX(clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (bounds.w / rect.width);
  }

  function reset(): void {
    ball = createInitialBall(bounds, wordmark);
    paddle = createInitialPaddle(bounds);
    colorIndex = 0;
    input = createInputState();
    flashUntil = 0;
    running = true;
    paused = false;
    overlay.hidden = true;
    winOverlay.hidden = true;
    pauseOverlay.hidden = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function draw(): void {
    const flashing = performance.now() < flashUntil;
    ctx.fillStyle = flashing ? "#ffffff" : "#000000";
    ctx.fillRect(0, 0, bounds.w, bounds.h);

    ctx.fillStyle = ball.color;
    ctx.font = `italic bold ${WORDMARK_FONT_SIZE}px "Courier New", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Anchor offset by the measured ink bounds, not the box center, so the
    // drawn glyphs land exactly on the ball's collision rect (see
    // measureWordmark).
    ctx.fillText(WORDMARK_TEXT, ball.x + wordmark.offsetX, ball.y + wordmark.offsetY);

    ctx.fillStyle = "#e6e6f0";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
  }

  function loop(time: number): void {
    if (!running) return;
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    if (!paused) {
      const dx = resolvePaddleDelta(input, paddle, PADDLE_SPEED, dt);
      if (dx !== 0) paddle = movePaddle(paddle, dx, bounds);
    }

    const result = stepGame(ball, paddle, bounds, dt, paused);
    ball = result.ball;

    if (result.wallHit) {
      colorIndex = (colorIndex + 1) % COLORS.length;
      ball = { ...ball, color: COLORS[colorIndex]! };
    }
    if (result.cornerHit) {
      flashUntil = time + 150;
    }

    draw();

    if (result.gameOver) {
      running = false;
      overlay.hidden = false;
      return;
    }

    if (result.win) {
      running = false;
      winOverlay.hidden = false;
      return;
    }

    requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", (event) => {
    if (MOVE_KEYS.has(event.code)) event.preventDefault();
    if (event.code === "KeyA" || event.code === "ArrowLeft") input = setInputKey(input, "left", true);
    if (event.code === "KeyD" || event.code === "ArrowRight") input = setInputKey(input, "right", true);
    if (event.code === "Escape" || event.code === "KeyP") {
      paused = togglePause(paused, running);
      pauseOverlay.hidden = !paused;
    }
    if (!running && (event.code === "Space" || event.code === "Enter")) reset();
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "KeyA" || event.code === "ArrowLeft") input = setInputKey(input, "left", false);
    if (event.code === "KeyD" || event.code === "ArrowRight") input = setInputKey(input, "right", false);
  });

  canvas.addEventListener("mousemove", (event) => {
    input = setInputPointer(input, pointerToCanvasX(event.clientX));
  });

  canvas.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (touch) input = setInputPointer(input, pointerToCanvasX(touch.clientX));
    },
    { passive: false },
  );

  canvas.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (touch) input = setInputPointer(input, pointerToCanvasX(touch.clientX));
    },
    { passive: false },
  );

  restartButton.addEventListener("click", reset);
  restartWinButton.addEventListener("click", reset);

  draw();
  requestAnimationFrame(loop);
}

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const overlay = document.querySelector<HTMLDivElement>("#game-over");
const restartButton = document.querySelector<HTMLButtonElement>("#restart");
const winOverlay = document.querySelector<HTMLDivElement>("#game-win");
const restartWinButton = document.querySelector<HTMLButtonElement>("#restart-win");
const pauseOverlay = document.querySelector<HTMLDivElement>("#game-paused");

if (canvas && overlay && restartButton && winOverlay && restartWinButton && pauseOverlay) {
  const ctx = canvas.getContext("2d");
  if (ctx) initGame(canvas, ctx, overlay, restartButton, winOverlay, restartWinButton, pauseOverlay);
}
