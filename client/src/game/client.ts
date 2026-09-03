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
import { DemoDriver } from "./demo";
import { Hud } from "./hud";
import { InputController } from "./input";
import { Particles } from "./particles";
import { Renderer, teamColor, type Grave } from "./renderer";
import type { Sound } from "./sound";
import { INTERP_DELAY_MS, SnapshotBuffer } from "./state";
import { TerrainRenderer } from "./terrainRenderer";
import { drawWeaponIcon, WEAPON_NAMES, WEAPON_ORDER } from "./weapons";
import { canvasResolution } from "./viewport";
import { enterFullscreen } from "./display";
import type { TouchControl } from "./input";

export interface GameCallbacks {
  send(msg: ClientMessage): void;
  leaveRoom(): void;
  backToLobby(): void;
  rtt(): number;
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
}

/** Spina render, wejście, dźwięk i sieć w jedną pętlę gry. */
export class GameClient {
  private els: Els;
  private ctx: CanvasRenderingContext2D;
  private camera = new Camera();
  private particles = new Particles();
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
  private pending: { at: number; ev: GameEvent }[] = [];
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private demo: DemoDriver | null = null;
  private demoAcc = 0;
  private waterShown = WATER_LEVEL_START;
  private selectedWeapon: WeaponId = "bazooka";
  private panelOpen = false;
  private escOpen = false;
  private overOpen = false;
  private showMap = false;
  private autoFullscreenAttempted = false;
  private pixelRatio = 1;
  private shownCharge = -1;
  private touchEnabled = matchMedia("(any-pointer: coarse)").matches;
  private readonly resizeObserver = new ResizeObserver(() => this.resize());
  private slots = new Map<WeaponId, { el: HTMLButtonElement; ammo: HTMLElement; count?: number; selected?: boolean }>();
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
    };
    const ctx = this.els.canvas.getContext("2d");
    if (!ctx) throw new Error("Brak kontekstu 2D");
    this.ctx = ctx;

    this.input = new InputController(this.els.canvas, this.camera, {
      sendInput: (state) => {
        if (this.demo) this.demo.applyInput(state);
        else this.cb.send({ t: "input", state });
      },
      sendAction: (action) => {
        if (action.kind === "selectWeapon") this.selectedWeapon = action.weapon;
        this.sendAction(action);
        if (action.kind === "fire") this.sound.play("shot");
        if (action.kind === "jump" || action.kind === "backflip") this.sound.play("jump");
      },
      toggleWeaponPanel: () => this.toggleWeapons(),
      closeWeaponPanel: () => this.setWeapons(false),
      toggleEscMenu: () => this.toggleEsc(),
      gesture: () => {
        this.sound.unlock();
        if (this.running && !this.autoFullscreenAttempted) void this.fullscreen();
      },
      toggleMap: () => this.toggleMap(),
      fullscreen: () => { void this.fullscreen(); },
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

  start(config: GameConfig, players: PlayerInfo[], myTeam: number, demo = false): void {
    this.config = config;
    this.players = players;
    this.myTeam = myTeam;
    this.graves = [];
    this.lastPos.clear();
    this.pending = [];
    this.buffer.clear();
    this.particles.clear();
    this.hud.clear();
    this.selectedWeapon = "bazooka";
    this.waterShown = WATER_LEVEL_START;
    this.showMap = false;
    byId("btn-map").setAttribute("aria-pressed", "false");
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

    this.demo = demo ? new DemoDriver(config) : null;
    this.demoAcc = 0;
    this.els.demoControls.hidden = !demo;
    byId("btn-back-lobby").textContent = demo ? "Wróć do menu" : "Wróć do lobby";
    this.input.setContext({ myTurn: false, worm: null, weapon: "bazooka", blocked: true });
    if (this.demo) {
      // Oddzielny teren renderera: zdarzenia wizualne nie mogą zmieniać fizyki.
      this.onTerrainSync(this.demo.terrainSync());
      this.onSnapshot(this.demo.snapshot);
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
    if (this.demo) {
      this.myTeam = s.turn.activeTeam;
      const team = s.teams.find((t) => t.team === this.myTeam);
      const label = `Sterujesz: ${team?.name ?? "—"} · ${TEAM_NAMES[this.myTeam] ?? ""}`;
      if (this.els.demoTeam.textContent !== label) this.els.demoTeam.textContent = label;
      this.els.demoSkip.disabled = s.turn.phase !== "active";
    }
    for (const w of s.worms) {
      this.lastPos.set(w.id, { x: w.x, y: w.y, team: w.team, name: w.name });
    }
    // `turn.selectedWeapon` dotyczy AKTYWNEJ drużyny – przejmujemy je tylko w swojej turze,
    // inaczej panel/HUD pokazywałby broń przeciwnika (i kasował nasz lokalny wybór).
    if (s.turn.selectedWeapon && (this.demo || s.turn.activeTeam === this.myTeam)) {
      this.selectedWeapon = s.turn.selectedWeapon;
    }
    this.refreshWeaponPanel();
  }

  onEvents(events: GameEvent[]): void {
    // opóźniamy o bufor interpolacji, żeby efekty pasowały do rysowanych pozycji
    const at = performance.now() + INTERP_DELAY_MS;
    for (const ev of events) this.pending.push({ at, ev });
  }

  onTerrainSync(sync: TerrainSync): void {
    this.terrain = Terrain.fromRLE(sync.width, sync.height, sync.rle);
    this.terrainTex?.setTerrain(this.terrain);
  }

  onGameOver(winnerTeam: number | null, winnerName: string | null, stats: Record<string, unknown>): void {
    this.overOpen = true;
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
    const state = this.buffer.sample(now);
    this.particles.update(dt);
    this.hud.update(dt);

    if (state) {
      const turn = state.turn;
      const active = state.worms.find((w) => w.id === turn.activeWormId && w.alive);
      // kamera: kadr na pociskach + strzelcu > zbliżenie na aktywnego robaka > widok całej mapy
      if (state.projectiles.length > 0) {
        const points = state.projectiles.map((p) => ({ x: p.x, y: p.y }));
        if (active) points.push({ x: active.x, y: active.y });
        this.camera.frame(points);
      } else if (active && turn.phase === "active") {
        this.camera.focus(active.x, active.y - 20);
      } else {
        // między turami / w odwrocie / gdy fizyka się uspokaja: widok całej mapy,
        // wycentrowany pionowo na żywych robakach (ekran bywa niższy niż świat)
        const alive = state.worms.filter((w) => w.alive);
        if (alive.length > 0) this.camera.frame(alive, { maxZoom: this.camera.fitZoom, margin: 60 });
        else this.camera.overview(active?.x);
      }
      this.waterShown += (turn.waterLevel - this.waterShown) * Math.min(1, dt * 2.5);
      this.input.setContext({
        myTurn: this.isMyTurn(state.turn.activeTeam, state.turn.phase),
        worm: active ?? null,
        weapon: this.selectedWeapon,
        blocked: this.panelOpen || this.escOpen || this.overOpen,
      });
    }
    this.input.update(dt);
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
        terrain: this.terrain,
        theme: this.config.theme,
        camera: this.camera,
        particles: this.particles,
        time: this.time,
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
    if (this.demo) this.demo.applyAction(action);
    else this.cb.send({ t: "action", action });
  }

  // ---------------- zdarzenia ----------------

  private flushEvents(now: number): void {
    while (this.pending.length > 0 && this.pending[0].at <= now) {
      const { ev } = this.pending.shift()!;
      this.applyEvent(ev);
    }
  }

  private applyEvent(ev: GameEvent): void {
    const pal = this.terrainTex?.palette;
    switch (ev.t) {
      case "explosion": {
        this.terrain.carveCircle(ev.x, ev.y, ev.r);
        this.terrainTex?.markDirty(ev.x - ev.r - 2, ev.y - ev.r - 2, ev.r * 2 + 4, ev.r * 2 + 4);
        this.particles.explosion(ev.x, ev.y, ev.r, pal?.debris ?? "#8a5f38");
        this.camera.shake(Math.min(30, ev.r * 0.55));
        this.camera.glance(ev.x, ev.y, 0.25);
        break;
      }
      case "carveRect": {
        this.terrain.paintRotatedRect(ev.x, ev.y, ev.w, ev.h, ev.angle, ev.add ? 1 : 0);
        const ext = Math.ceil(Math.hypot(ev.w, ev.h) / 2) + 2;
        this.terrainTex?.markDirty(ev.x - ext, ev.y - ext, ext * 2, ext * 2);
        if (ev.add) this.particles.sparks(ev.x, ev.y, 10, "#ffd08a");
        break;
      }
      case "damage": {
        const w = this.lastPos.get(ev.wormId);
        const col = w ? teamColor(w.team) : "#ff6a6a";
        this.particles.floatText(ev.x, ev.y - 18, `-${Math.round(ev.amount)}`, col, 19);
        this.renderer.onDamage(ev.wormId, ev.amount);
        break;
      }
      case "wormDied": {
        this.renderer.onKill(ev.wormId);
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
        this.particles.sparks(ev.x, ev.y, 8, "#ffe07a");
        const shooter = this.buffer.latest?.turn.activeWormId;
        if (shooter !== undefined) this.renderer.onShot(shooter);
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
        this.hud.banner(`${name ?? TEAM_NAMES[ev.team % TEAM_NAMES.length]} – twoja kolej`, 1.7);
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
      slot.title = WEAPON_NAMES[id];
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      const cx = c.getContext("2d");
      if (cx) {
        cx.scale(3, 3);
        cx.translate(20, 20);
        drawWeaponIcon(cx, id, 34);
      }
      const name = document.createElement("div");
      name.className = "wname";
      name.textContent = WEAPON_NAMES[id];
      const ammo = document.createElement("span");
      ammo.className = "wammo";
      slot.append(c, name, ammo);
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
    const ammoLabel = ammo === undefined ? "" : ammo < 0 ? "∞" : String(ammo);
    if (this.els.currentAmmo.textContent !== ammoLabel) this.els.currentAmmo.textContent = ammoLabel;
  }

  private toggleWeapons(): void {
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
    byId("btn-fullscreen").addEventListener("click", () => { void this.fullscreen(); });
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
        this.start({ ...this.config, seed: (Math.random() * 0x7fffffff) | 0 }, [], 0, true);
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
    this.els.volume.addEventListener("input", () => {
      this.sound.volume = Number(this.els.volume.value) / 100;
    });
  }

  // ---------------- rozmiar ----------------

  async fullscreen(): Promise<void> {
    this.autoFullscreenAttempted = true;
    await enterFullscreen();
    this.resize();
    if (this.running && !this.escOpen && !this.panelOpen && !this.overOpen) this.els.canvas.focus({ preventScroll: true });
  }

  private toggleMap(): void {
    this.showMap = !this.showMap;
    byId("btn-map").setAttribute("aria-pressed", String(this.showMap));
    if (this.running && !this.escOpen && !this.panelOpen && !this.overOpen) this.els.canvas.focus({ preventScroll: true });
  }

  private syncControls(): void {
    const blocked = this.panelOpen || this.escOpen || this.overOpen;
    byId("touch-controls").hidden = !this.touchEnabled || blocked;
    if (blocked) this.input.cancelControls();
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
        if (!this.autoFullscreenAttempted) void this.fullscreen();
        this.input.pressControl(control);
      });
      const release = (event: PointerEvent) => {
        if (pointer !== event.pointerId) return;
        pointer = null;
        button.dataset.pressed = "false";
        this.input.releaseControl(control, event.type !== "pointerup");
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    }
    this.syncControls();
  }

  private resize(): void {
    this.pixelRatio = window.devicePixelRatio || 1;
    const w = this.els.canvas.clientWidth || window.innerWidth;
    const h = this.els.canvas.clientHeight || window.innerHeight;
    const resolution = canvasResolution(w, h, this.pixelRatio);
    this.els.canvas.width = resolution.width;
    this.els.canvas.height = resolution.height;
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
