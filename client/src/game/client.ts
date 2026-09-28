import { FIXED_DT, TEAM_NAMES, WATER_LEVEL_START, WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import { generateTerrain, Terrain } from "@shared/engine/terrain";
import type {
  ClientMessage,
  GameConfig,
  GameEvent,
  GameSnapshot,
  InputAction,
  PlayerInfo,
  TerrainSync,
  WeaponId,
} from "@shared/protocol";
import { Camera } from "./camera";
import { DemoDriver, type LocalMode } from "./demo";
import { soloArena, soloStageInfo, type SoloRoute } from "./solo";
import { Hud } from "./hud";
import { InputController } from "./input";
import { Particles } from "./particles";
import { LocalPrediction } from "./prediction";
import { Renderer, teamColor, type Grave } from "./renderer";
import type { Sound } from "./sound";
import { INTERP_DELAY_MS, LOCAL_INTERP_DELAY_MS, SnapshotBuffer } from "./state";
import { TerrainRenderer } from "./terrainRenderer";
import { drawWeaponIcon, WEAPON_COLORS, WEAPON_HINTS, WEAPON_NAMES, WEAPON_ORDER } from "./weapons";
import { canvasResolution } from "./viewport";
import { enterFullscreen, fullscreenHelp } from "./display";
import type { TouchControl } from "./input";

export interface GameCallbacks {
  send(msg: ClientMessage): void;
  leaveRoom(): void;
  backToLobby(): void;
  rtt(): number;
  connected(): boolean;
  toast(text: string, kind?: "info" | "err" | "ok"): void;
}

interface Els {
  canvas: HTMLCanvasElement;
  weaponPanel: HTMLElement;
  weaponGrid: HTMLElement;
  escMenu: HTMLElement;
  gameover: HTMLElement;
  goTitle: HTMLElement;
  goStats: HTMLElement;
  volume: HTMLInputElement;
  demoControls: HTMLElement;
  demoTeam: HTMLElement;
  demoSkip: HTMLButtonElement;
  fire: HTMLButtonElement;
  currentWeapon: HTMLElement;
  currentAmmo: HTMLElement;
  defenseStatus: HTMLElement;
}

/** Spina render, wejście, dźwięk i sieć w jedną pętlę gry. */
export class GameClient {
  private els: Els;
  private ctx: CanvasRenderingContext2D;
  private camera = new Camera();
  private particles = new Particles();
  private prediction = new LocalPrediction();
  private inputSeq = 0;
  private hud = new Hud();
  private renderer = new Renderer();
  private buffer = new SnapshotBuffer();
  private input: InputController;
  private terrain: Terrain = new Terrain(WORLD_WIDTH, WORLD_HEIGHT);
  private terrainTex: TerrainRenderer | null = null;
  private config: GameConfig | null = null;
  private players: PlayerInfo[] = [];
  private myTeam = -1;
  private graves: Grave[] = [];
  private lastPos = new Map<number, { x: number; y: number; team: number; name: string }>();
  private trackedWorm: { id: number; x: number; y: number } | null = null;
  private homingImpact: { x: number; y: number } | null = null;
  private homingImpactUntil = 0;
  private pending: { at: number; ev: GameEvent; seq: number }[] = [];
  private lastEventSeq = 0;
  private terrainSyncSeq = 0;
  private appliedTerrainSeq = 0;
  private missingEventsSince = 0;
  private resyncRequestedAt = 0;
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private demo: DemoDriver | null = null;
  private soloRun: { stage: number; seed: number; base: GameConfig; route: SoloRoute } | null = null;
  private demoAcc = 0;
  private waterShown = WATER_LEVEL_START;
  private selectedWeapon: WeaponId = "bazooka";
  private panelOpen = false;
  private escOpen = false;
  private overOpen = false;
  private showMap = false;
  private autoFullscreenAttempted = false;
  private pixelRatio = 1;
  private hudTop = 8;
  private shownCharge = -1;
  private selectedDefenseWormId: number | null = null;
  private defenseManual = false;
  private defenseTurnKey = "";
  private defensePendingAt = 0;
  private touchEnabled = matchMedia("(any-pointer: coarse)").matches;
  private touchResetters: Array<() => void> = [];
  private readonly resizeObserver = new ResizeObserver(() => this.resize());
  private slots = new Map<WeaponId, { el: HTMLButtonElement; ammo: HTMLElement; count?: number; selected?: boolean }>();
  private readonly weaponBadge: HTMLCanvasElement;
  private weaponBadgeWeapon: WeaponId | null = null;
  private onResize = (): void => this.resize();

  constructor(
    private readonly sound: Sound,
    private readonly cb: GameCallbacks,
  ) {
    this.els = {
      canvas: byId<HTMLCanvasElement>("game-canvas"),
      weaponPanel: byId("weapon-panel"),
      weaponGrid: byId("weapon-grid"),
      escMenu: byId("esc-menu"),
      gameover: byId("gameover"),
      goTitle: byId("go-title"),
      goStats: byId("go-stats"),
      volume: byId<HTMLInputElement>("volume"),
      demoControls: byId("demo-controls"),
      demoTeam: byId("demo-team"),
      demoSkip: byId<HTMLButtonElement>("btn-demo-skip"),
      fire: byId<HTMLButtonElement>("touch-fire"),
      currentWeapon: byId("current-weapon"),
      currentAmmo: byId("current-ammo"),
      defenseStatus: byId("defense-status"),
    };
    const ctx = this.els.canvas.getContext("2d");
    if (!ctx) throw new Error("Brak kontekstu 2D");
    this.ctx = ctx;
    this.weaponBadge = document.createElement("canvas");
    this.weaponBadge.className = "weapon-badge";
    this.weaponBadge.width = 84;
    this.weaponBadge.height = 84;
    byId("btn-weapons").prepend(this.weaponBadge);

    this.input = new InputController(this.els.canvas, this.camera, {
      sendInput: (state) => {
        if (this.demo) this.demo.applyInput(state);
        else if (this.cb.connected()) {
          const turn = this.buffer.latest?.turn;
          const seq = ++this.inputSeq;
          this.prediction.onInputSent(seq, state);
          this.cb.send({ t: "input", seq, state, turn: turn ? { round: turn.round, wormId: turn.activeWormId } : undefined });
        }
      },
      sendAction: (action) => {
        if (action.kind === "selectWeapon") this.selectedWeapon = action.weapon;
        this.sendAction(action);
        if (action.kind === "fire" && (this.demo || this.cb.connected())) this.sound.play("shot");
        if (action.kind === "jump" || action.kind === "backflip") this.sound.play("jump");
      },
      sendDefense: (control) => this.sendDefense(control),
      selectDefense: (direction) => this.selectDefense(direction),
      selectDefenseAt: (x, y) => this.selectDefenseAt(x, y),
      toggleWeaponPanel: () => this.toggleWeapons(),
      closeWeaponPanel: () => this.setWeapons(false),
      toggleEscMenu: () => this.toggleEsc(),
      gesture: () => {
        this.sound.unlock();
        if (this.running && !this.autoFullscreenAttempted) void this.fullscreen(false);
      },
      toggleMap: () => this.toggleMap(),
      fullscreen: () => { void this.fullscreen(true); },
    });

    this.buildWeaponPanel();
    this.wireOverlays();
    this.wireTouchControls();
    document.addEventListener("fullscreenchange", this.onResize);
  }

  // ---------------- diagnostyka (tryb ?debug=1 / demo) ----------------

  /** Ostatni odebrany snapshot (bez interpolacji). */
  get lastSnapshot(): GameSnapshot | null {
    return this.buffer.latest;
  }

  /** Indeks mojej drużyny. */
  get team(): number {
    return this.myTeam;
  }

  /** Świat -> ekran (diagnostyka / testy automatyczne). */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    return this.camera.worldToScreen(x, y);
  }

  /** Suma stałych pikseli terenu + wersja – do porównania terenu między klientami. */
  terrainStats(): { version: number; solid: number; width: number; height: number } {
    let solid = 0;
    const d = this.terrain.data;
    for (let i = 0; i < d.length; i++) solid += d[i];
    return { version: this.terrain.version, solid, width: this.terrain.width, height: this.terrain.height };
  }

  // ---------------- cykl życia ----------------

  start(config: GameConfig, players: PlayerInfo[], myTeam: number, localMode: LocalMode | false = false): void {
    if (localMode === "gauntlet") {
      this.soloRun ??= { stage: 1, seed: config.seed, base: config, route: "supplies" };
      config = soloArena(this.soloRun.base, this.soloRun.seed, this.soloRun.stage, this.soloRun.route);
    } else this.soloRun = null;
    this.config = config;
    this.players = players;
    this.myTeam = myTeam;
    this.graves = [];
    this.lastPos.clear();
    this.trackedWorm = null;
    this.homingImpact = null;
    this.homingImpactUntil = 0;
    this.pending = [];
    this.lastEventSeq = 0;
    this.terrainSyncSeq = 0;
    this.appliedTerrainSeq = 0;
    this.missingEventsSince = 0;
    this.resyncRequestedAt = 0;
    this.buffer.clear();
    this.prediction.reset();
    this.inputSeq = 0;
    this.selectedDefenseWormId = null;
    this.defenseManual = false;
    this.defenseTurnKey = "";
    this.defensePendingAt = 0;
    this.els.defenseStatus.hidden = true;
    this.buffer.setInterpolationDelay(localMode ? LOCAL_INTERP_DELAY_MS : INTERP_DELAY_MS);
    this.particles.clear();
    this.hud.clear();
    this.selectedWeapon = "bazooka";
    this.waterShown = WATER_LEVEL_START;
    this.showMap = false;
    byId("btn-map").setAttribute("aria-pressed", "false");
    // Pierwsza klatka nowego meczu przywróci etykiety CEL po obronie w poprzednim meczu.
    delete byId("screen-game").dataset.defending;
    this.terrain = generateTerrain(config.seed, WORLD_WIDTH, WORLD_HEIGHT, config.terrainDensity);
    this.terrainTex = new TerrainRenderer(this.terrain, config.theme, config.seed);
    this.renderer.regen(config.seed);
    this.renderer.setTheme(config.theme);
    this.camera.resetManual();
    this.camera.overview(undefined, undefined, true);
    this.setOverlay(this.els.gameover, false);
    this.overOpen = false;
    this.setWeapons(false);
    this.setEsc(false);
    this.els.volume.value = String(Math.round(this.sound.volume * 100));

    this.demo = localMode ? new DemoDriver(config, localMode, this.soloRun?.stage ?? 0) : null;
    this.demoAcc = 0;
    this.els.demoControls.hidden = !localMode;
    byId("btn-back-lobby").textContent = localMode ? "Wróć do menu" : "Wróć do lobby";
    this.input.setContext({ myTurn: false, worm: null, weapon: "bazooka", blocked: true });
    if (this.demo) {
      // Oddzielny teren renderera: zdarzenia wizualne nie mogą zmieniać fizyki.
      this.onTerrainSync(this.demo.terrainSync());
      this.onSnapshot(this.demo.snapshot);
      if (this.soloRun) {
        const stage = soloStageInfo(this.soloRun.stage);
        this.hud.banner(`Arena ${this.soloRun.stage} · ${stage.name}: ${stage.description}`, 3.6);
      }
    }

    window.addEventListener("resize", this.onResize);
    window.visualViewport?.addEventListener("resize", this.onResize);
    this.resizeObserver.observe(this.els.canvas);
    this.resize();
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.visualViewport?.removeEventListener("resize", this.onResize);
    this.resizeObserver.disconnect();
    this.demo = null;
    this.soloRun = null;
    this.els.defenseStatus.hidden = true;
    this.prediction.reset();
    this.els.demoControls.hidden = true;
    this.input.setContext({ myTurn: false, worm: null, weapon: "bazooka", blocked: true });
  }

  destroy(): void {
    this.stop();
    this.input.destroy();
    document.removeEventListener("fullscreenchange", this.onResize);
  }

  // ---------------- wiadomości z serwera ----------------

  onSnapshot(s: GameSnapshot): void {
    this.buffer.push(s);
    this.prediction.onSnapshot(s);
    if (!this.demo && s.eventSeq !== undefined && s.eventSeq > this.lastEventSeq) {
      if (!this.missingEventsSince) this.missingEventsSince = performance.now();
      if (performance.now() - this.missingEventsSince > 250) this.requestTerrainRepair();
    } else this.missingEventsSince = 0;
    if (this.demo) {
      this.myTeam = this.demo.controlledTeam;
      const team = s.teams.find((t) => t.team === this.myTeam);
      const label = this.demo.mode === "computer"
        ? this.demo.computerTurn ? "Ruch komputera…" : "Twoja tura"
        : `Sterujesz: ${team?.name ?? "—"} · ${TEAM_NAMES[this.myTeam] ?? ""}`;
      if (this.els.demoTeam.textContent !== label) this.els.demoTeam.textContent = label;
      this.els.demoSkip.disabled = s.turn.phase !== "active" || this.demo.computerTurn;
    }
    for (const w of s.worms) {
      this.lastPos.set(w.id, { x: w.x, y: w.y, team: w.team, name: w.name });
    }
    // `turn.selectedWeapon` dotyczy AKTYWNEJ drużyny – przejmujemy je tylko w swojej turze,
    // inaczej panel/HUD pokazywałby broń przeciwnika (i kasował nasz lokalny wybór).
    if (s.turn.selectedWeapon && (this.demo?.mode === "twoPlayers" || s.turn.activeTeam === this.myTeam)) {
      this.selectedWeapon = s.turn.selectedWeapon;
    }
    if (s.turn.activeTeam !== this.myTeam && this.panelOpen) this.setWeapons(false);
    this.refreshWeaponPanel();
  }

  onEvents(events: GameEvent[], seq?: number): void {
    if (seq !== undefined) {
      if (seq <= this.lastEventSeq) return;
      if (seq > this.lastEventSeq + 1) this.requestTerrainRepair();
      this.lastEventSeq = seq;
      this.missingEventsSince = 0;
    }
    // opóźniamy o bufor interpolacji, żeby efekty pasowały do rysowanych pozycji
    const at = performance.now() + (this.demo ? this.buffer.interpolationDelayMs :
      this.buffer.latest?.turn.activeTeam === this.myTeam ? 0 : this.buffer.interpolationDelayMs);
    let changedTerrain = false;
    for (const ev of events) {
      // Teren jest częścią stanu gry, więc zmieniamy go od razu. Opóźniona
      // jest tylko animacja dla obserwatora. W przeciwnym razie terrainSync
      // przychodzący po eventach wciąż widzi starą bitmapę i przebudowuje
      // całą teksturę po każdym wybuchu.
      if (seq === undefined || seq > this.terrainSyncSeq) {
        this.applyTerrainEvent(ev);
        changedTerrain ||= ev.t === "explosion" || ev.t === "burrow" || ev.t === "carveRect";
      }
      this.pending.push({ at, ev, seq: seq ?? 0 });
    }
    if (changedTerrain && seq !== undefined) this.appliedTerrainSeq = Math.max(this.appliedTerrainSeq, seq);
  }

  onTerrainSync(sync: TerrainSync): void {
    if (sync.eventSeq !== undefined && sync.eventSeq < this.appliedTerrainSeq) {
      this.requestTerrainRepair();
      return;
    }
    // Tury kończą się pełnym syncem, choć wybuchy zostały już odtworzone
    // z eventów. Pełny repaint 1920x1080 powodował zauważalne przycięcie.
    if (!this.terrain.matchesRLE(sync.width, sync.height, sync.rle)) {
      this.terrain = Terrain.fromRLE(sync.width, sync.height, sync.rle);
      this.terrainTex?.setTerrain(this.terrain);
    }
    if (sync.eventSeq !== undefined) {
      this.terrainSyncSeq = Math.max(this.terrainSyncSeq, sync.eventSeq);
      this.appliedTerrainSeq = Math.max(this.appliedTerrainSeq, sync.eventSeq);
      this.lastEventSeq = Math.max(this.lastEventSeq, sync.eventSeq);
      this.missingEventsSince = 0;
    }
  }

  private requestTerrainRepair(): void {
    const now = performance.now();
    if (!this.cb.connected() || now - this.resyncRequestedAt < 1500) return;
    this.resyncRequestedAt = now;
    this.cb.send({ t: "requestTerrainSync" });
  }

  onGameOver(winnerTeam: number | null, winnerName: string | null, stats: Record<string, unknown>): void {
    this.overOpen = true;
    this.els.defenseStatus.hidden = true;
    const next = byId<HTMLButtonElement>("btn-solo-next");
    next.hidden = !this.soloRun;
    next.hidden = !this.soloRun || winnerTeam === 0;
    if (this.soloRun) next.textContent = "Nowa wyprawa";
    byId("solo-routes").hidden = !this.soloRun || winnerTeam !== 0;
    this.syncControls();
    const title = this.els.goTitle;
    if (winnerTeam === null) {
      title.textContent = "Remis";
      title.style.color = "#e7ecf5";
    } else {
      title.textContent = `Wygrywa: ${winnerName ?? TEAM_NAMES[winnerTeam % TEAM_NAMES.length]}`;
      title.style.color = teamColor(winnerTeam);
    }
    const st = this.buffer.latest;
    const rows: string[] = [];
    if (this.soloRun) rows.push(`<div class="go-row"><span class="grow">Wyprawa solo · ${escapeHtml(soloStageInfo(this.soloRun.stage).name)}</span><b>Arena ${this.soloRun.stage}</b></div>`);
    if (st) {
      for (const t of st.teams) {
        rows.push(
          `<div class="go-row" style="border-left-color:${teamColor(t.team)}">
             <span class="grow"><b>${escapeHtml(t.name || TEAM_NAMES[t.team % TEAM_NAMES.length])}</b>
             <span class="dim"> · ${TEAM_NAMES[t.team % TEAM_NAMES.length]}</span></span>
             <span class="dim">${Math.max(0, Math.round(t.totalHp))} HP</span>
             <span class="dim">${t.alive} żywych</span>
           </div>`,
        );
      }
    }
    const STAT_LABELS: Record<string, string> = {
      round: "Rundy",
      durationSec: "Czas gry",
      ticks: "Kroki symulacji",
    };
    for (const [k, v] of Object.entries(stats ?? {})) {
      if (typeof v === "number" || typeof v === "string") {
        const label = STAT_LABELS[k] ?? k;
        const val = k === "durationSec" ? formatDuration(Number(v)) : String(v);
        rows.push(`<div class="go-row"><span class="grow dim">${escapeHtml(label)}</span><b>${escapeHtml(val)}</b></div>`);
      }
    }
    this.els.goStats.innerHTML = rows.join("");
    this.setOverlay(this.els.gameover, true);
    this.sound.play("hallelujah");
  }

  // ---------------- pętla ----------------

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    // Turn-based controls remain responsive at ~30 fps on 60 Hz phones; half
    // as many full canvas repaints saves GPU bandwidth and battery.
    if (this.touchEnabled && now - this.last < 28) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (this.pixelRatio !== (window.devicePixelRatio || 1)) this.resize();

    if (this.demo && !this.overOpen && !this.escOpen) {
      this.demoAcc += dt;
      while (this.demoAcc >= FIXED_DT) {
        this.demoAcc -= FIXED_DT;
        const { snapshot, events } = this.demo.update();
        this.onSnapshot(snapshot);
        if (events.length) this.onEvents(events);
        if (this.demo.isOver) {
          const winner = this.demo.winner;
          this.onGameOver(winner.team, winner.name, { round: snapshot.turn.round, durationSec: snapshot.time });
          break;
        }
      }
    }

    // 1) zdarzenia (zawsze przed renderem snapshotu)
    this.flushEvents(now);

    // 2) stan do wyrenderowania
    // Sterujący widzi najświeższy stan. Bufor 220 ms jest wyłącznie dla obserwatora.
    let state = !this.demo && this.buffer.latest?.turn.activeTeam === this.myTeam
      ? this.buffer.latest : this.buffer.sample(now);
    if (state) {
      // Obrona trwa tylko ułamek sekundy; opóźnienie obrazu widza nie może opóźnić sterowania.
      const controlTurn = this.buffer.latest?.turn ?? state.turn;
      const controlState = this.buffer.latest ?? state;
      const active = controlState.worms.find((w) => w.id === controlTurn.activeWormId && w.alive);
      this.input.setContext({
        myTurn: this.isMyTurn(controlTurn.activeTeam, controlTurn.phase),
        defenseReady: !!controlTurn.defenseWindow && !!controlTurn.defenseReady?.includes(this.myTeam) &&
          (!this.demo || this.demo.computerTurn) && (!this.defensePendingAt || now - this.defensePendingAt > 950),
        worm: active ?? null,
        weapon: this.selectedWeapon,
        blocked: this.panelOpen || this.escOpen || this.overOpen,
      });
    }
    this.input.update(dt);
    this.updateDefenseControls(state);
    if (state && !this.demo) {
      if (!this.demo) state = this.prediction.apply(state, this.terrain, this.input.currentState,
        this.myTeam, dt, now, this.cb.rtt());
    }
    this.particles.update(dt);
    this.hud.update(dt);

    if (state) {
      const turn = state.turn;
      const active = state.worms.find((w) => w.id === turn.activeWormId && w.alive);
      const previous = active && this.trackedWorm?.id === active.id ? this.trackedWorm : null;
      const observedVx = previous ? (active!.x - previous.x) / Math.max(dt, 1 / 240) : active?.vx ?? 0;
      const observedVy = previous ? (active!.y - previous.y) / Math.max(dt, 1 / 240) : active?.vy ?? 0;
      const moving = !!active && (!!previous && Math.hypot(active.x - previous.x, active.y - previous.y) > 0.04);
      const falling = !!active && (!active.onGround || Math.abs(active.vy) > 3 || Math.abs(observedVy) > 3);
      // kamera: prowadzenie pojedynczego pocisku / kadr salwy > aktywny robak > widok całej mapy
      if (this.homingImpact && this.time < this.homingImpactUntil) {
        const victim = state.worms.filter((w) => w.alive)
          .sort((a, b) => Math.hypot(a.x - this.homingImpact!.x, a.y - this.homingImpact!.y) -
            Math.hypot(b.x - this.homingImpact!.x, b.y - this.homingImpact!.y))[0];
        this.camera.frame(victim ? [this.homingImpact, victim] : [this.homingImpact],
          { maxZoom: this.camera.projectileZoom, margin: 110 });
      } else if (state.projectiles.length === 1) {
        const p = state.projectiles[0];
        if (p.kind === "homing" && p.homingTarget) {
          this.camera.frame(active ? [active, p, p.homingTarget] : [p, p.homingTarget],
            { maxZoom: this.camera.projectileZoom, margin: 125 });
        } else this.camera.trackProjectile(p.x, p.y, p.vx, p.vy);
      } else if (state.projectiles.length > 1) {
        const points = state.projectiles.map((p) => ({ x: p.x, y: p.y }));
        this.camera.frame(points, { maxZoom: this.camera.projectileZoom, margin: 100 });
      } else if (active && (
        turn.phase === "active" || turn.phase === "retreat" || (turn.phase === "settling" && falling)
      )) {
        // Ruch pieszy zmienia bezpośrednio x, więc łączymy prędkość silnika z ruchem zaobserwowanym między klatkami.
        const vx = Math.abs(active.vx) > Math.abs(observedVx) ? active.vx : observedVx;
        const vy = Math.abs(active.vy) > Math.abs(observedVy) ? active.vy : observedVy;
        const closestRival = this.camera.viewW < 1000
          ? state.worms.filter((other) => other.alive && other.team !== active.team)
            .sort((a, b) => Math.abs(a.x - active.x) - Math.abs(b.x - active.x))[0]
          : undefined;
        const rivalLead = closestRival ? Math.max(-70, Math.min(70, (closestRival.x - active.x) * 0.12)) : 0;
        const leadX = Math.max(-110, Math.min(110, vx * 0.2)) + active.facing * 26 + rivalLead;
        const leadY = Math.max(-55, Math.min(115, vy * 0.13));
        // Gdy robak faktycznie idzie lub spada, odzyskujemy auto-focus po wcześniejszym przesunięciu kamery.
        this.camera.focus(active.x + leadX, active.y + leadY - 16, undefined, false, moving || falling);
      } else {
        // między turami / w odwrocie / gdy fizyka się uspokaja: widok całej mapy,
        // wycentrowany pionowo na żywych robakach (ekran bywa niższy niż świat)
        const alive = state.worms.filter((w) => w.alive);
        if (alive.length > 0) this.camera.frame(alive, { maxZoom: this.camera.fitZoom, margin: 60 });
        else this.camera.overview(active?.x);
      }
      this.trackedWorm = active ? { id: active.id, x: active.x, y: active.y } : null;
      this.waterShown += (turn.waterLevel - this.waterShown) * Math.min(1, dt * 2.5);
    }
    const charge = Math.round(this.input.chargePower * 360);
    if (charge !== this.shownCharge) {
      this.shownCharge = charge;
      this.els.fire.style.setProperty("--charge", `${charge}deg`);
      this.els.fire.dataset.charging = String(charge > 0);
    }

    this.camera.update(dt);
    this.terrainTex?.update();

    // 3) render
    const tex = this.terrainTex?.canvas;
    if (state && tex && this.config) {
      const myTurn = this.isMyTurn(state.turn.activeTeam, state.turn.phase);
      this.renderer.draw(this.ctx, {
        state,
        terrainTex: tex,
        theme: this.config.theme,
        camera: this.camera,
        particles: this.particles,
        time: this.time,
        selectedDefenseWormId: !myTurn ? this.selectedDefenseWormId : null,
        myTeam: this.myTeam,
        myTurn,
        graves: this.graves,
        weapon: this.selectedWeapon,
        aimPitch: this.input.aimPitch,
        localCharge: this.input.chargePower,
        mouseWorld: this.input.mouseOnCanvas ? { x: this.input.mouseWX, y: this.input.mouseWY } : null,
        waterLevel: this.waterShown,
      });
      this.hud.draw(this.ctx, {
        state,
        camera: this.camera,
        terrainTex: tex,
        myTeam: this.myTeam,
        rtt: this.cb.rtt(),
        time: this.time,
        weapon: this.selectedWeapon,
        demo: this.demo !== null,
        showMap: this.showMap,
        touch: this.touchEnabled,
        stale: !this.demo && this.prediction.ageMs > 1_500,
        topInset: this.hudTop,
      });
    } else {
      this.ctx.fillStyle = "#0a0e15";
      this.ctx.fillRect(0, 0, this.camera.viewW, this.camera.viewH);
      this.ctx.fillStyle = "#93a0b8";
      this.ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText("Ładowanie stanu gry…", this.camera.viewW / 2, this.camera.viewH / 2);
    }
  };

  private isMyTurn(activeTeam: number, phase: string): boolean {
    return activeTeam === this.myTeam && (phase === "active" || phase === "retreat");
  }

  private sendAction(action: InputAction): void {
    if (!this.demo && !this.cb.connected() && action.kind !== "selectWeapon" && action.kind !== "setTimer") {
      this.cb.toast("Brak połączenia. Poczekaj na synchronizację przed ruchem.", "err");
      return;
    }
    if (this.demo) this.demo.applyAction(action);
    else {
      const turn = this.buffer.latest?.turn;
      this.cb.send({ t: "action", action, turn: turn ? { round: turn.round, wormId: turn.activeWormId } : undefined });
    }
  }

  // ---------------- zdarzenia ----------------

  private flushEvents(now: number): void {
    while (this.pending.length > 0 && this.pending[0].at <= now) {
      const { ev } = this.pending.shift()!;
      this.applyEvent(ev);
    }
  }

  private applyTerrainEvent(ev: GameEvent): void {
    switch (ev.t) {
      case "burrow":
      case "explosion":
        this.terrain.carveCircle(ev.x, ev.y, ev.r);
        this.terrainTex?.markDirty(ev.x - ev.r - 2, ev.y - ev.r - 2, ev.r * 2 + 4, ev.r * 2 + 4);
        break;
      case "carveRect": {
        this.terrain.paintRotatedRect(ev.x, ev.y, ev.w, ev.h, ev.angle, ev.add ? 1 : 0);
        const ext = Math.ceil(Math.hypot(ev.w, ev.h) / 2) + 2;
        this.terrainTex?.markDirty(ev.x - ext, ev.y - ext, ext * 2, ext * 2);
        break;
      }
    }
  }

  private applyEvent(ev: GameEvent): void {
    const pal = this.terrainTex?.palette;
    switch (ev.t) {
      case "burrow": {
        this.particles.sparks(ev.x, ev.y, 2, "#a2eefb");
        break;
      }
      case "explosion": {
        this.particles.explosion(ev.x, ev.y, ev.r, pal?.debris ?? "#8a5f38", ev.style);
        this.renderer.onExplosion(ev.r, ev.power);
        this.renderer.onWormsStartled(ev.x, ev.y, ev.r);
        this.camera.shake(Math.min(22, 2 + ev.r * 0.24 + ev.power * 0.006));
        if (ev.style === "homing") {
          this.homingImpact = { x: ev.x, y: ev.y };
          this.homingImpactUntil = this.time + 1.1;
        } else this.camera.glance(ev.x, ev.y, 0.25);
        break;
      }
      case "carveRect": {
        if (ev.add) this.particles.sparks(ev.x, ev.y, 10, "#ffd08a");
        break;
      }
      case "damage": {
        const w = this.lastPos.get(ev.wormId);
        const col = w ? teamColor(w.team) : "#ff6a6a";
        this.particles.floatText(ev.x, ev.y - 18, `-${Math.round(ev.amount)}`, col, 19);
        this.particles.hitFeedback(ev.x, ev.y, ev.amount, col);
        this.renderer.onDamage(ev.wormId, ev.amount);
        break;
      }
      case "wormDied": {
        this.renderer.onKill(ev.wormId);
        this.sound.play("died");
        const w = this.lastPos.get(ev.wormId);
        if (w) {
          if (ev.reason === "drown") {
            this.particles.splash(w.x, this.waterShown, this.terrainTex?.palette.waterFoam ?? "rgba(150,215,255,1)");
          } else {
            this.graves.push({ x: w.x, y: w.y + 1, team: w.team, name: w.name });
          }
          this.particles.puff(w.x, w.y, teamColor(w.team), 14);
          const reason =
            ev.reason === "drown" ? "utonął" : ev.reason === "fall" ? "spadł" : ev.reason === "surrender" ? "poddał się" : "zginął";
          this.hud.kill(`${w.name} ${reason}`, teamColor(w.team));
        }
        break;
      }
      case "shot": {
        const fx = weaponFireEffect(ev.weapon);
        this.particles.sparks(ev.x, ev.y, fx.sparks, fx.color);
        if (ev.weapon === "bazooka" || ev.weapon === "homing" ||
            ev.weapon === "shotgun" || ev.weapon === "uzi") {
          this.particles.muzzleFlash(ev.x, ev.y, ev.weapon === "shotgun" ? 1.2 : 0.9, fx.color);
        }
        this.camera.shake(fx.kick);
        const shooter = this.buffer.latest?.turn.activeWormId;
        if (shooter !== undefined) this.renderer.onShot(shooter);
        break;
      }
      case "split": {
        this.particles.split(ev.x, ev.y, ev.weapon);
        this.camera.shake(ev.weapon === "banana" ? 5 : 3);
        this.sound.play(ev.weapon === "banana" ? "bananaSplit" : "clusterSplit");
        break;
      }
      case "bulletTrace": {
        this.particles.bulletTrace(ev.x0, ev.y0, ev.x, ev.y, ev.weapon, ev.hit);
        break;
      }
      case "batHit": {
        this.particles.batHit(ev.x, ev.y, ev.dx, ev.dy);
        this.camera.shake(5);
        break;
      }
      case "teleport": {
        this.particles.teleport(ev.fromX, ev.fromY);
        this.particles.teleport(ev.toX, ev.toY);
        this.camera.glance(ev.toX, ev.toY, 0.35);
        break;
      }
      case "crateSpawn": {
        this.hud.banner("Zrzut zaopatrzenia!", 1.6);
        break;
      }
      case "cratePickup": {
        this.renderer.onPickup(ev.wormId);
        const w = this.lastPos.get(ev.wormId);
        if (w) {
          const label =
            ev.kind === "health"
              ? `+${ev.amount ?? 25} HP`
              : ev.weapon
                ? WEAPON_NAMES[ev.weapon] ?? ev.weapon
                : "Bonus";
          this.particles.floatText(w.x, w.y - 24, label, "#7ee787", 17);
        }
        break;
      }
      case "turnStart": {
        this.renderer.onTurnStart(ev.team);
        this.camera.resetManual();
        const name = this.buffer.latest?.teams.find((t) => t.team === ev.team)?.name;
        const label = name ?? TEAM_NAMES[ev.team % TEAM_NAMES.length];
        this.hud.banner(ev.team === this.myTeam ? "Twoja tura" : `${label} rozpoczyna turę`, 1.1);
        break;
      }
      case "defense": {
        this.particles.sparks(ev.x, ev.y, ev.style === "jump" ? 17 : 10, "#9debff");
        this.particles.floatText(ev.x, ev.y - 32, ev.style === "jump" ? "SKOK!" : "ODSKOK!", "#aff0ff", 17);
        this.sound.play("jump");
        break;
      }
      case "treeFall": {
        this.particles.sparks(ev.x, ev.y - 18, 12, "#9d734a");
        this.camera.glance(ev.x + ev.direction * 38, ev.y - 32, 0.4);
        break;
      }
      case "springTriggered": {
        this.particles.sparks(ev.x, ev.y - 9, 17, "#ffce65");
        this.particles.floatText(ev.x, ev.y - 40, "BOING!", "#ffda75", 20);
        this.camera.glance(ev.x, ev.y - 35, 0.3);
        break;
      }
      case "suddenDeath": {
        this.hud.banner("SUDDEN DEATH!", 3);
        break;
      }
      case "message": {
        this.hud.banner(ev.text, 2.6);
        break;
      }
      case "sound": {
        this.sound.play(ev.name);
        break;
      }
    }
  }

  // ---------------- panel broni / menu ----------------

  private buildWeaponPanel(): void {
    this.els.weaponGrid.innerHTML = "";
    for (const id of WEAPON_ORDER) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.setAttribute("aria-label", WEAPON_NAMES[id]);
      slot.className = "wslot";
      slot.title = `${WEAPON_NAMES[id]} – ${WEAPON_HINTS[id]}`;
      slot.style.setProperty("--weapon-color", WEAPON_COLORS[id]);
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      const cx = c.getContext("2d");
      if (cx) {
        cx.scale(3, 3);
        cx.translate(20, 20);
        cx.fillStyle = "rgba(255,255,255,.08)";
        cx.beginPath();
        cx.arc(0, 0, 18, 0, Math.PI * 2);
        cx.fill();
        drawWeaponIcon(cx, id, 34);
      }
      const name = document.createElement("div");
      name.className = "wname";
      name.textContent = WEAPON_NAMES[id];
      const ammo = document.createElement("span");
      ammo.className = "wammo";
      slot.append(c, name, ammo);
      slot.addEventListener("pointerenter", () => this.showWeaponTip(id));
      slot.addEventListener("focus", () => this.showWeaponTip(id));
      slot.addEventListener("pointerleave", () => this.showWeaponTip(this.selectedWeapon));
      slot.addEventListener("click", () => {
        if (slot.classList.contains("empty")) return;
        this.selectedWeapon = id;
        this.sendAction({ kind: "selectWeapon", weapon: id });
        this.sound.play("tick");
        this.setWeapons(false);
        this.refreshWeaponPanel();
      });
      this.els.weaponGrid.appendChild(slot);
      this.slots.set(id, { el: slot, ammo });
    }
  }

  private refreshWeaponPanel(): void {
    const my = this.buffer.latest?.teams.find((t) => t.team === this.myTeam);
    for (const [id, s] of this.slots) {
      const n = my?.ammo?.[id];
      if (n !== s.count) {
        s.count = n;
        s.ammo.textContent = n === undefined ? "" : n < 0 ? "∞" : String(n);
        s.el.classList.toggle("empty", n === 0);
        s.el.disabled = n === 0;
      }
      const selected = id === this.selectedWeapon;
      if (s.selected !== selected) {
        s.selected = selected;
        s.el.classList.toggle("sel", selected);
        s.el.setAttribute("aria-pressed", String(selected));
      }
    }
    const ammo = my?.ammo?.[this.selectedWeapon];
    const label = WEAPON_NAMES[this.selectedWeapon];
    if (this.els.currentWeapon.textContent !== label) this.els.currentWeapon.textContent = label;
    if (this.weaponBadgeWeapon !== this.selectedWeapon) {
      this.weaponBadgeWeapon = this.selectedWeapon;
      const cx = this.weaponBadge.getContext("2d");
      if (cx) {
        cx.clearRect(0, 0, 84, 84);
        cx.translate(42, 42);
        drawWeaponIcon(cx, this.selectedWeapon, 68);
        cx.setTransform(1, 0, 0, 1, 0, 0);
      }
      byId("btn-weapons").style.setProperty("--weapon-color", WEAPON_COLORS[this.selectedWeapon]);
      this.showWeaponTip(this.selectedWeapon);
    }
    const ammoLabel = ammo === undefined ? "" : ammo < 0 ? "∞" : String(ammo);
    if (this.els.currentAmmo.textContent !== ammoLabel) this.els.currentAmmo.textContent = ammoLabel;
  }

  private showWeaponTip(id: WeaponId): void {
    byId("weapon-tip").textContent = `${WEAPON_NAMES[id]} · ${WEAPON_HINTS[id]}`;
  }

  private toggleWeapons(): void {
    if (this.buffer.latest && this.buffer.latest.turn.activeTeam !== this.myTeam) return;
    this.setWeapons(!this.panelOpen);
  }

  private setWeapons(open: boolean): void {
    this.panelOpen = open && !this.escOpen && !this.overOpen;
    this.els.weaponPanel.hidden = !this.panelOpen;
    byId("btn-weapons").setAttribute("aria-expanded", String(this.panelOpen));
    this.syncControls();
    if (this.panelOpen) this.refreshWeaponPanel();
    else if (this.running && !this.escOpen && !this.overOpen) this.els.canvas.focus({ preventScroll: true });
  }

  private toggleEsc(): void {
    if (this.overOpen) return;
    this.setEsc(!this.escOpen);
  }

  private setEsc(open: boolean): void {
    this.escOpen = open;
    this.setOverlay(this.els.escMenu, open);
    byId("btn-menu").setAttribute("aria-expanded", String(open));
    this.syncControls();
    if (open) this.setWeapons(false);
    else if (this.running) this.els.canvas.focus({ preventScroll: true });
  }

  private setOverlay(el: HTMLElement, open: boolean): void {
    el.hidden = !open;
  }

  private wireOverlays(): void {
    byId("btn-fullscreen").addEventListener("click", () => { void this.fullscreen(true); });
    byId("btn-menu").addEventListener("click", () => this.toggleEsc());
    byId("btn-weapons").addEventListener("click", () => this.toggleWeapons());
    byId("btn-close-weapons").addEventListener("click", () => this.setWeapons(false));
    byId("btn-map").addEventListener("click", () => this.toggleMap());
    this.els.demoSkip.addEventListener("click", () => {
      this.demo?.applyAction({ kind: "skipTurn" });
      this.setEsc(false);
    });
    byId("btn-demo-restart").addEventListener("click", () => {
      if (this.demo && this.config) {
        this.start({ ...this.config, seed: (Math.random() * 0x7fffffff) | 0 }, [], 0, this.demo.mode);
      }
    });
    byId("btn-resume").addEventListener("click", () => this.setEsc(false));
    byId("btn-surrender").addEventListener("click", () => {
      if (!confirm("Na pewno chcesz się poddać? Twoje robaki zginą.")) return;
      this.sendAction({ kind: "surrender" });
      this.setEsc(false);
    });
    byId("btn-quit").addEventListener("click", () => {
      this.setEsc(false);
      this.cb.leaveRoom();
    });
    byId("btn-back-lobby").addEventListener("click", () => {
      this.setOverlay(this.els.gameover, false);
      this.overOpen = false;
      this.cb.backToLobby();
    });
    byId("btn-solo-next").addEventListener("click", () => {
      const run = this.soloRun;
      if (!run) return;
      run.stage = 1;
      run.seed = Math.floor(Math.random() * 0x7fffffff);
      run.route = "supplies";
      this.start(run.base, [], 0, "gauntlet");
    });
    for (const route of ["supplies", "armory"] as const) {
      byId(`btn-solo-${route}`).addEventListener("click", () => {
        const run = this.soloRun;
        if (!run || this.demo?.winner.team !== 0) return;
        run.stage++;
        run.route = route;
        this.start(run.base, [], 0, "gauntlet");
      });
    }
    this.els.volume.addEventListener("input", () => {
      this.sound.volume = Number(this.els.volume.value) / 100;
    });
  }

  // ---------------- rozmiar ----------------

  async fullscreen(showHelp = false): Promise<void> {
    this.autoFullscreenAttempted = true;
    const entered = await enterFullscreen();
    if (!entered && showHelp) {
      this.cb.toast(fullscreenHelp() ?? "Ta przeglądarka nie pozwala włączyć pełnego ekranu.");
    }
    this.resize();
    if (this.running && !this.escOpen && !this.panelOpen && !this.overOpen) this.els.canvas.focus({ preventScroll: true });
  }

  private toggleMap(): void {
    this.showMap = !this.showMap;
    byId("btn-map").setAttribute("aria-pressed", String(this.showMap));
    if (this.running && !this.escOpen && !this.panelOpen && !this.overOpen) this.els.canvas.focus({ preventScroll: true });
  }

  private updateDefenseControls(state: GameSnapshot | null): void {
    const snapshot = this.buffer.latest ?? state;
    const turn = snapshot?.turn;
    const waiting = !!turn && (!this.demo || this.demo.computerTurn) && !this.overOpen && !this.escOpen && !this.panelOpen &&
      turn.phase !== "gameOver" && turn.activeTeam >= 0 && turn.activeTeam !== this.myTeam;
    this.els.defenseStatus.hidden = !waiting;
    const screen = byId("screen-game");
    if ((screen.dataset.defending === "true") !== waiting) {
      screen.dataset.defending = String(waiting);
      for (const button of document.querySelectorAll<HTMLButtonElement>('.touch-aim-key')) {
        const label = button.querySelector("small");
        if (label) label.textContent = waiting ? "ROBAK" : "CEL";
        button.setAttribute("aria-label", waiting
          ? (button.dataset.control === "aimUp" ? "Wybierz poprzedniego robaka" : "Wybierz następnego robaka")
          : (button.dataset.control === "aimUp" ? "Celuj wyżej" : "Celuj niżej"));
      }
    }
    byId<HTMLButtonElement>("btn-weapons").hidden = waiting;
    if (waiting) {
      const key = `${turn.round}:${turn.activeWormId}`;
      if (key !== this.defenseTurnKey) {
        this.defenseTurnKey = key;
        this.selectedDefenseWormId = null;
        this.defenseManual = false;
        this.defensePendingAt = 0;
      }
      const worms = snapshot!.worms.filter((w) => w.team === this.myTeam && w.alive);
      if (!this.defenseManual || !worms.some((w) => w.id === this.selectedDefenseWormId)) {
        const threats = snapshot!.projectiles;
        const active = snapshot!.worms.find((w) => w.id === turn.activeWormId);
        const score = (w: typeof worms[number]): number => threats.length
          ? Math.min(...threats.map((p) => Math.hypot(p.x - w.x, p.y - w.y)))
          : Math.abs(w.x - (active?.x ?? w.x));
        this.selectedDefenseWormId = worms.reduce<typeof worms[number] | null>((best, w) =>
          !best || score(w) < score(best) ? w : best, null)?.id ?? null;
      }
      const online = !!this.demo || this.cb.connected();
      const ready = online && !!turn.defenseWindow && !!turn.defenseReady?.includes(this.myTeam) &&
        this.selectedDefenseWormId !== null && (!this.defensePendingAt || performance.now() - this.defensePendingAt > 950);
      const selected = worms.find((w) => w.id === this.selectedDefenseWormId);
      const status = !online ? "Brak połączenia" : !turn.defenseWindow
        ? `${selected?.name ?? "Robak"} · ▲▼ wybór · po strzale ◀ ▶ / SKOK` :
          ready ? `${selected?.name ?? "Robak"} · ◀ ▶ krok / SKOK odskok!` : "Ruch obronny wykorzystany";
      if (this.els.defenseStatus.textContent !== status) this.els.defenseStatus.textContent = status;
    }
  }

  private selectDefense(direction: -1 | 1): void {
    const snap = this.buffer.latest;
    if (!snap || snap.turn.activeTeam === this.myTeam || this.escOpen || this.overOpen) return;
    const worms = snap.worms.filter((w) => w.team === this.myTeam && w.alive);
    if (!worms.length) return;
    const i = worms.findIndex((w) => w.id === this.selectedDefenseWormId);
    this.selectedDefenseWormId = worms[i < 0 ? 0 : (i + direction + worms.length) % worms.length]!.id;
    this.defenseManual = true;
    this.updateDefenseControls(snap);
  }

  private selectDefenseAt(x: number, y: number): void {
    const snap = this.buffer.latest;
    if (!snap || snap.turn.activeTeam === this.myTeam || this.escOpen || this.overOpen) return;
    const worm = snap.worms.filter((w) => w.team === this.myTeam && w.alive)
      .find((w) => Math.abs(w.x - x) < 26 && y >= w.y - 40 && y <= w.y + 15);
    if (!worm) return;
    this.selectedDefenseWormId = worm.id;
    this.defenseManual = true;
    this.updateDefenseControls(snap);
  }

  private sendDefense(control: "left" | "right" | "jump"): void {
    const snap = this.buffer.latest;
    if (!snap?.turn.defenseWindow || !snap.turn.defenseReady?.includes(this.myTeam) ||
      this.selectedDefenseWormId === null || (this.demo ? !this.demo.computerTurn : !this.cb.connected()) ||
      (this.defensePendingAt && performance.now() - this.defensePendingAt < 950)) return;
    this.defensePendingAt = performance.now();
    this.sendAction(control === "jump"
      ? { kind: "defend", style: "jump", wormId: this.selectedDefenseWormId }
      : { kind: "defend", style: "step", wormId: this.selectedDefenseWormId, direction: control === "left" ? -1 : 1 });
    this.updateDefenseControls(snap);
  }

  private syncControls(): void {
    const blocked = this.panelOpen || this.escOpen || this.overOpen;
    byId("touch-controls").hidden = !this.touchEnabled || blocked;
    if (blocked) this.els.defenseStatus.hidden = true;
    if (!this.touchEnabled || blocked) {
      for (const reset of this.touchResetters) reset();
      this.input.cancelControls();
    }
  }

  private wireTouchControls(): void {
    const toggle = byId<HTMLInputElement>("touch-enabled");
    toggle.checked = this.touchEnabled;
    toggle.addEventListener("change", () => {
      this.touchEnabled = toggle.checked;
      this.input.cancelControls();
      this.syncControls();
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-control]")) {
      const control = button.dataset.control as TouchControl;
      let pointer: number | null = null;
      button.addEventListener("pointerdown", (event) => {
        if (pointer !== null) return;
        event.preventDefault();
        pointer = event.pointerId;
        button.setPointerCapture(pointer);
        button.dataset.pressed = "true";
        this.sound.unlock();
        if (!this.autoFullscreenAttempted) void this.fullscreen(false);
        this.input.pressControl(control);
      });
      const release = (event: PointerEvent) => {
        if (pointer !== event.pointerId) return;
        pointer = null;
        button.dataset.pressed = "false";
        this.input.releaseControl(control, event.type !== "pointerup");
      };
      this.touchResetters.push(() => {
        if (pointer === null) return;
        pointer = null;
        button.dataset.pressed = "false";
        this.input.releaseControl(control, true);
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    }
    this.syncControls();
  }

  private resize(): void {
    this.pixelRatio = window.devicePixelRatio || 1;
    const toolsTop = document.querySelector<HTMLElement>(".game-tools");
    this.hudTop = toolsTop ? Number.parseFloat(getComputedStyle(toolsTop).top) || 8 : 8;
    const w = this.els.canvas.clientWidth || window.innerWidth;
    const h = this.els.canvas.clientHeight || window.innerHeight;
    const resolution = canvasResolution(w, h, this.pixelRatio, this.touchEnabled);
    if (this.els.canvas.width !== resolution.width) this.els.canvas.width = resolution.width;
    if (this.els.canvas.height !== resolution.height) this.els.canvas.height = resolution.height;
    this.ctx.setTransform(resolution.width / w, 0, 0, resolution.height / h, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.camera.setViewport(w, h);
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Brak elementu #${id}`);
  return el as T;
}

function weaponFireEffect(weapon: WeaponId): { color: string; sparks: number; kick: number } {
  switch (weapon) {
    case "homing": return { color: "#79efff", sparks: 12, kick: 1.8 };
    case "cluster": return { color: "#66ffd3", sparks: 13, kick: 1.4 };
    case "drill": return { color: "#a2eefb", sparks: 12, kick: 1.7 };
    case "banana": return { color: "#fff04d", sparks: 15, kick: 2 };
    case "holy": return { color: "#fffbd1", sparks: 20, kick: 3 };
    case "dynamite": return { color: "#ff4b35", sparks: 9, kick: 1 };
    case "airstrike": return { color: "#ff745c", sparks: 14, kick: 1.8 };
    case "shotgun": return { color: "#fff1bd", sparks: 18, kick: 2.5 };
    case "uzi": return { color: "#bceaff", sparks: 6, kick: 0.7 };
    case "teleport": return { color: "#be8cff", sparks: 16, kick: 0.6 };
    default: return { color: "#ffe07a", sparks: 9, kick: 1.4 };
  }
}

/** 92.4 -> "1:32" */
function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return "—";
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
