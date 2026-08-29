import {
  activateSpeedBoost,
  advanceGameTime,
  BALL_HEIGHT,
  BALL_WIDTH,
  catchTriggersSpeedBoost,
  createInitialBall,
  createInitialPaddle,
  createInputState,
  createSmallBalls,
  createScoreState,
  deactivateSpeedBoost,
  DEFAULT_DIFFICULTY,
  INITIAL_SPEED_BOOST_STATE,
  movePaddle,
  pushTrailEntry,
  recordCatch,
  recordWin,
  resetCatches,
  resolvePaddleDelta,
  setInputKey,
  setInputPointer,
  SMALL_BALL_SCALE,
  speedBoostExpired,
  speedBoostRemainingMs,
  SPEED_BOOST_MULTIPLIER,
  stepEntities,
  togglePause,
  TRAIL_LENGTH,
  wallHitTriggersSpawn,
  type Ball,
  type Difficulty,
  type InputState,
  type Paddle,
  type ScoreState,
  type SpeedBoostState,
  type TrailEntry,
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
  gameOverCatchesEl: HTMLElement,
  gameOverBestEl: HTMLElement,
  winCatchesEl: HTMLElement,
  winBestEl: HTMLElement,
  modeSelectOverlay: HTMLDivElement,
  easyModeButton: HTMLButtonElement,
  hardModeButton: HTMLButtonElement,
  pauseContinueButton: HTMLButtonElement,
  pauseRestartButton: HTMLButtonElement,
  pauseChangeModeButton: HTMLButtonElement,
  winChangeModeButton: HTMLButtonElement,
): void {
  ctx.imageSmoothingEnabled = false;

  const bounds = { w: canvas.width, h: canvas.height };
  const PADDLE_SPEED = 390; // px/s
  const COLORS = ["#39ff88", "#ff4d6d", "#ffd93d", "#4dd2ff", "#c77dff"];
  const MOVE_KEYS = new Set(["KeyA", "KeyD", "ArrowLeft", "ArrowRight", "Space"]);
  // Trail is sampled on a fixed cadence of gameTime (not every frame) so its
  // TRAIL_LENGTH afterimages span a visible stretch of history regardless of
  // frame rate, and alpha is capped below 1 so the real logo (drawn at full
  // opacity right after) always reads as the most visible thing on screen.
  const TRAIL_SAMPLE_INTERVAL_MS = 45;
  const TRAIL_MAX_ALPHA = 0.45;
  const BOOST_HUD_COLOR = "#ffd93d";

  // Text/font never change at runtime, so the ink bounding box is measured
  // once and reused as the collision size for every ball created below.
  const wordmark = measureWordmark(ctx);

  // Every logo (main or small) is tagged with its own id as soon as it's
  // created, purely so the trail below can track "this logo's history"
  // across frames — stepEntities returns fresh Ball objects every step, so
  // object identity can't be used for that.
  let nextBallId = 1;
  let balls: Ball[] = [{ ...createInitialBall(bounds, wordmark), id: nextBallId++ }];
  let paddle: Paddle = createInitialPaddle(bounds);
  let colorIndex = 0;
  // Deliberately declared outside reset() (only its `catches` field is
  // zeroed there): `best` is Normal Mode's session-only record and must
  // survive a restart, living purely in this variable so a page refresh
  // (not just a restart) is what clears it.
  let score: ScoreState = createScoreState();
  let collisionCount = 0;
  let speedBoost: SpeedBoostState = INITIAL_SPEED_BOOST_STATE;
  // Pause-aware clock (only advances while !paused) that SpeedBoostState and
  // the trail's sample cadence are measured against, so both freeze exactly
  // on pause and resume from precisely where they left off.
  let gameTime = 0;
  // One small fixed-length trail per currently-alive logo, keyed by its id.
  // Dead ids (a small logo missed the paddle) are pruned every sample tick
  // so the map never grows past however many logos are actually on screen.
  let trails: Map<number, TrailEntry[]> = new Map();
  let lastTrailSampleAt = -Infinity;
  let running = false;
  let paused = false;
  let flashUntil = 0;
  let lastTime = performance.now();
  let input: InputState = createInputState();
  // Chosen once on the mode-select screen and carried through every
  // restart of the current session — only the mode-select screen (not the
  // in-game restart buttons) changes it. Defaults to DEFAULT_DIFFICULTY
  // purely as a placeholder before the player has chosen; it can't affect
  // gameplay because the loop never runs until modeChosen is true.
  let difficulty: Difficulty = DEFAULT_DIFFICULTY;
  let modeChosen = false;
  // Tracks the single in-flight requestAnimationFrame callback. The loop
  // keeps re-scheduling itself every frame even while paused (so `lastTime`
  // stays fresh and resuming doesn't see a huge dt) — so anything that
  // restarts the loop out-of-band (reset, goToModeSelect) must cancel
  // whichever frame is already pending first, or two loops would run
  // concurrently and double-step the game.
  let rafHandle: number | null = null;

  function pointerToCanvasX(clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (bounds.w / rect.width);
  }

  function scheduleLoop(): void {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = requestAnimationFrame(loop);
  }

  function togglePauseState(): void {
    paused = togglePause(paused, running);
    pauseOverlay.hidden = !paused;
  }

  function reset(): void {
    nextBallId = 1;
    balls = [{ ...createInitialBall(bounds, wordmark), id: nextBallId++ }];
    paddle = createInitialPaddle(bounds);
    colorIndex = 0;
    score = resetCatches(score);
    collisionCount = 0;
    speedBoost = INITIAL_SPEED_BOOST_STATE;
    gameTime = 0;
    trails = new Map();
    lastTrailSampleAt = -Infinity;
    input = createInputState();
    flashUntil = 0;
    running = true;
    paused = false;
    overlay.hidden = true;
    winOverlay.hidden = true;
    pauseOverlay.hidden = true;
    lastTime = performance.now();
    scheduleLoop();
  }

  /** Locks in the chosen difficulty for this play session and starts the first game. Only the mode-select screen calls this — restarts reuse the same difficulty via reset(). */
  function startGame(mode: Difficulty): void {
    difficulty = mode;
    modeChosen = true;
    modeSelectOverlay.hidden = true;
    reset();
  }

  /**
   * "Change Mode": exits the current game entirely (from the pause menu or
   * the win screen) and reopens mode-select, without touching the session's
   * best score. Clears modeChosen (not just running) so the Space/Enter
   * restart shortcut can't fire while the mode-select screen is back up —
   * the same guard that protects it before the very first mode is ever
   * chosen. Hides every overlay it could have been called from so none of
   * them linger behind mode-select.
   */
  function goToModeSelect(): void {
    running = false;
    paused = false;
    modeChosen = false;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    overlay.hidden = true;
    winOverlay.hidden = true;
    pauseOverlay.hidden = true;
    modeSelectOverlay.hidden = false;
  }

  /**
   * Shared glyph-drawing primitive behind both the real logos and the trail's
   * afterimages, so a trail entry is guaranteed to render as the exact same
   * wordmark artwork — never a placeholder rectangle — just at reduced alpha.
   */
  function drawWordmark(x: number, y: number, color: string, scale: number, alpha: number = 1): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `italic bold ${WORDMARK_FONT_SIZE * scale}px "Courier New", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Anchor offset by the measured ink bounds, not the box center, so the
    // drawn glyphs land exactly on the logo's collision rect (see
    // measureWordmark).
    ctx.fillText(WORDMARK_TEXT, x + wordmark.offsetX * scale, y + wordmark.offsetY * scale);
    ctx.restore();
  }

  function drawBall(logo: Ball): void {
    // Small interference logos render at SMALL_BALL_SCALE so their drawn ink
    // matches the smaller collision rect createSmallBalls gave them.
    const scale = logo.kind === "small" ? SMALL_BALL_SCALE : 1;
    drawWordmark(logo.x, logo.y, logo.color, scale);
  }

  /**
   * Fading afterimages of every currently-boosted logo (main and small
   * alike), oldest (faintest) drawn first so each logo's most recent trail
   * entry — and the real logo, drawn at full opacity right after — sit
   * visually on top of its own trail.
   */
  function drawTrail(): void {
    for (const entries of trails.values()) {
      const len = entries.length;
      for (let i = 0; i < len; i++) {
        const entry = entries[i]!;
        const recency = (len - i) / len; // 1 for the newest entry, smallest for the oldest
        drawWordmark(entry.x, entry.y, entry.color, entry.scale, TRAIL_MAX_ALPHA * recency);
      }
    }
  }

  /** "SPEED UP n.n" countdown, purely reflecting speedBoostRemainingMs — hidden once the boost isn't active. Sits below the difficulty label so the two never overlap. */
  function drawSpeedBoostHud(remainingMs: number): void {
    if (remainingMs <= 0) return;
    ctx.save();
    ctx.font = `bold 16px "Courier New", ui-monospace, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = BOOST_HUD_COLOR;
    ctx.fillText(`SPEED UP ${(remainingMs / 1000).toFixed(1)}`, bounds.w - 10, 30);
    ctx.restore();
  }

  /**
   * Unobtrusive "EASY" / "HARD" readout, top-right — the only in-game
   * indication of which corner-win rule is active. No rules text, just the
   * mode name, and it stays drawn on the canvas (so it's still visible,
   * dimmed, once a win/game-over overlay covers the canvas).
   */
  function drawDifficultyHud(mode: Difficulty): void {
    ctx.save();
    ctx.font = `bold 16px "Courier New", ui-monospace, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#e6e6f0";
    ctx.fillText(mode.toUpperCase(), bounds.w - 10, 10);
    ctx.restore();
  }

  /** Always-visible "CATCHES: n" / "BEST: n" (or "—" before any win this session) readout, top-left. */
  function drawScoreHud(current: ScoreState): void {
    ctx.save();
    ctx.font = `bold 16px "Courier New", ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#e6e6f0";
    ctx.fillText(`CATCHES: ${current.catches}`, 10, 10);
    ctx.fillText(`BEST: ${current.best === null ? "—" : current.best}`, 10, 30);
    ctx.restore();
  }

  function draw(time: number): void {
    const flashing = time < flashUntil;
    ctx.fillStyle = flashing ? "#ffffff" : "#000000";
    ctx.fillRect(0, 0, bounds.w, bounds.h);

    drawTrail();
    for (const logo of balls) drawBall(logo);

    ctx.fillStyle = "#e6e6f0";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);

    drawScoreHud(score);
    if (modeChosen) drawDifficultyHud(difficulty);
    drawSpeedBoostHud(speedBoostRemainingMs(speedBoost, gameTime));
  }

  function loop(time: number): void {
    if (!running) {
      rafHandle = null;
      return;
    }
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    gameTime = advanceGameTime(gameTime, dt, paused);

    if (!paused) {
      const dx = resolvePaddleDelta(input, paddle, PADDLE_SPEED, dt);
      if (dx !== 0) paddle = movePaddle(paddle, dx, bounds);
    }

    const result = stepEntities(balls, paddle, bounds, dt, paused, difficulty);
    balls = result.balls;
    const main = result.main;

    balls = balls.map((logo, i) =>
      logo.kind === "small" && result.wallHits[i]
        ? { ...logo, color: COLORS[(COLORS.indexOf(logo.color) + 1) % COLORS.length]! }
        : logo,
    );

    balls = balls.map((logo, i) =>
      result.collisions[i]
        ? { ...logo, color: COLORS[(COLORS.indexOf(logo.color) + 1) % COLORS.length]! }
        : logo,
    );

    if (main.wallHit) {
      colorIndex = (colorIndex + 1) % COLORS.length;
      balls = balls.map((logo) => (logo.kind === "small" ? logo : { ...logo, color: COLORS[colorIndex]! }));

      collisionCount += 1;
      if (wallHitTriggersSpawn(collisionCount) && !main.win) {
        const mainLogo = balls.find((logo) => logo.kind !== "small")!;
        const spawned = createSmallBalls(mainLogo, bounds).map((logo) => ({ ...logo, id: nextBallId++ }));
        balls = [...balls, ...spawned];
      }
    }

    score = recordCatch(score, main.bounced);

    if (main.bounced) {
      if (catchTriggersSpeedBoost(score.catches)) {
        // Boosts every logo currently in play, main and small alike, so the
        // whole swarm speeds up together rather than just the main logo.
        if (!speedBoost.active) {
          balls = balls.map((logo) => ({
            ...logo,
            vx: logo.vx * SPEED_BOOST_MULTIPLIER,
            vy: logo.vy * SPEED_BOOST_MULTIPLIER,
          }));
        }
        speedBoost = activateSpeedBoost(gameTime);
      }
    }

    if (speedBoostExpired(speedBoost, gameTime)) {
      speedBoost = deactivateSpeedBoost(speedBoost);
      balls = balls.map((logo) => ({
        ...logo,
        vx: logo.vx / SPEED_BOOST_MULTIPLIER,
        vy: logo.vy / SPEED_BOOST_MULTIPLIER,
      }));
      trails.clear();
    }

    if (!paused && speedBoost.active && gameTime - lastTrailSampleAt >= TRAIL_SAMPLE_INTERVAL_MS) {
      lastTrailSampleAt = gameTime;
      const aliveIds = new Set(balls.map((logo) => logo.id));
      for (const id of trails.keys()) {
        if (!aliveIds.has(id)) trails.delete(id);
      }
      for (const logo of balls) {
        const scale = logo.kind === "small" ? SMALL_BALL_SCALE : 1;
        const prior = trails.get(logo.id!) ?? [];
        trails.set(
          logo.id!,
          pushTrailEntry(prior, { x: logo.x, y: logo.y, color: logo.color, scale }, TRAIL_LENGTH),
        );
      }
    }

    if (main.cornerHit) {
      flashUntil = time + 150;
    }

    draw(time);

    if (main.gameOver) {
      running = false;
      gameOverCatchesEl.textContent = String(score.catches);
      gameOverBestEl.textContent = score.best === null ? "—" : String(score.best);
      overlay.hidden = false;
      return;
    }

    if (main.win) {
      running = false;
      score = recordWin(score);
      winCatchesEl.textContent = String(score.catches);
      winBestEl.textContent = score.best === null ? "—" : String(score.best);
      winOverlay.hidden = false;
      return;
    }

    rafHandle = requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", (event) => {
    if (MOVE_KEYS.has(event.code)) event.preventDefault();
    if (event.code === "KeyA" || event.code === "ArrowLeft") input = setInputKey(input, "left", true);
    if (event.code === "KeyD" || event.code === "ArrowRight") input = setInputKey(input, "right", true);
    if (event.code === "Escape" || event.code === "KeyP") togglePauseState();
    if (!running && modeChosen && (event.code === "Space" || event.code === "Enter")) reset();
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
  easyModeButton.addEventListener("click", () => startGame("easy"));
  hardModeButton.addEventListener("click", () => startGame("hard"));
  pauseContinueButton.addEventListener("click", togglePauseState);
  pauseRestartButton.addEventListener("click", reset);
  pauseChangeModeButton.addEventListener("click", goToModeSelect);
  winChangeModeButton.addEventListener("click", goToModeSelect);

  // Static initial frame behind the mode-select overlay; the loop itself
  // only starts once a mode is chosen (see startGame -> reset).
  draw(performance.now());
}

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const overlay = document.querySelector<HTMLDivElement>("#game-over");
const restartButton = document.querySelector<HTMLButtonElement>("#restart");
const winOverlay = document.querySelector<HTMLDivElement>("#game-win");
const restartWinButton = document.querySelector<HTMLButtonElement>("#restart-win");
const pauseOverlay = document.querySelector<HTMLDivElement>("#game-paused");
const gameOverCatchesEl = document.querySelector<HTMLElement>("#game-over-catches");
const gameOverBestEl = document.querySelector<HTMLElement>("#game-over-best");
const winCatchesEl = document.querySelector<HTMLElement>("#game-win-catches");
const winBestEl = document.querySelector<HTMLElement>("#game-win-best");
const modeSelectOverlay = document.querySelector<HTMLDivElement>("#mode-select");
const easyModeButton = document.querySelector<HTMLButtonElement>("#mode-easy");
const hardModeButton = document.querySelector<HTMLButtonElement>("#mode-hard");
const pauseContinueButton = document.querySelector<HTMLButtonElement>("#pause-continue");
const pauseRestartButton = document.querySelector<HTMLButtonElement>("#pause-restart");
const pauseChangeModeButton = document.querySelector<HTMLButtonElement>("#pause-change-mode");
const winChangeModeButton = document.querySelector<HTMLButtonElement>("#win-change-mode");

if (
  canvas &&
  overlay &&
  restartButton &&
  winOverlay &&
  restartWinButton &&
  pauseOverlay &&
  gameOverCatchesEl &&
  gameOverBestEl &&
  winCatchesEl &&
  winBestEl &&
  modeSelectOverlay &&
  easyModeButton &&
  hardModeButton &&
  pauseContinueButton &&
  pauseRestartButton &&
  pauseChangeModeButton &&
  winChangeModeButton
) {
  const ctx = canvas.getContext("2d");
  if (ctx)
    initGame(
      canvas,
      ctx,
      overlay,
      restartButton,
      winOverlay,
      restartWinButton,
      pauseOverlay,
      gameOverCatchesEl,
      gameOverBestEl,
      winCatchesEl,
      winBestEl,
      modeSelectOverlay,
      easyModeButton,
      hardModeButton,
      pauseContinueButton,
      pauseRestartButton,
      pauseChangeModeButton,
      winChangeModeButton,
    );
}
