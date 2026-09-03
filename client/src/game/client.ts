import { TEAM_NAMES, WATER_LEVEL_START, WORLD_HEIGHT, WORLD_WIDTH } from "@shared/constants";
import { generateTerrain, Terrain } from "@shared/engine/terrain";
import type {
  ClientMessage,
  GameConfig,
  GameEvent,
  GameSnapshot,
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
  private slots = new Map<WeaponId, { el: HTMLElement; ammo: HTMLElement }>();
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
    };
    const ctx = this.els.canvas.getContext("2d");
    if (!ctx) throw new Error("Brak kontekstu 2D");
    this.ctx = ctx;

    this.input = new InputController(this.els.canvas, this.camera, {
      sendInput: (state) => {
        if (!this.demo) this.cb.send({ t: "input", state });
      },
      sendAction: (action) => {
        if (action.kind === "selectWeapon") this.selectedWeapon = action.weapon;
        if (!this.demo) this.cb.send({ t: "action", action });
        if (action.kind === "fire") this.sound.play("shot");
        if (action.kind === "jump" || action.kind === "backflip") this.sound.play("jump");
      },
      toggleWeaponPanel: () => this.toggleWeapons(),
      closeWeaponPanel: () => this.setWeapons(false),
      toggleEscMenu: () => this.toggleEsc(),
      gesture: () => this.sound.unlock(),
    });

    this.buildWeaponPanel();
    this.wireOverlays();
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
    this.terrain = generateTerrain(config.seed, WORLD_WIDTH, WORLD_HEIGHT, config.terrainDensity);
    this.terrainTex = new TerrainRenderer(this.terrain, config.theme, config.seed);
    this.renderer.regen(config.seed);
    this.renderer.setTheme(config.theme);
    this.camera.resetManual();
    this.camera.follow(WORLD_WIDTH / 2, WORLD_HEIGHT * 0.45, true);
    this.setOverlay(this.els.gameover, false);
    this.overOpen = false;
    this.setWeapons(false);
    this.setEsc(false);
    this.els.volume.value = String(Math.round(this.sound.volume * 100));

    this.demo = demo ? new DemoDriver(this.terrain) : null;
    this.hud.banner(demo ? "TRYB DEMO" : "Do boju!", 2.2);

    window.addEventListener("resize", this.onResize);
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
    this.demo = null;
  }

  destroy(): void {
    this.stop();
    this.input.destroy();
  }

  // ---------------- wiadomości z serwera ----------------

  onSnapshot(s: GameSnapshot): void {
    this.buffer.push(s);
    for (const w of s.worms) {
      this.lastPos.set(w.id, { x: w.x, y: w.y, team: w.team, name: w.name });
    }
    if (s.turn.selectedWeapon) this.selectedWeapon = s.turn.selectedWeapon;
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
    for (const [k, v] of Object.entries(stats ?? {})) {
      if (typeof v === "number" || typeof v === "string") {
        rows.push(`<div class="go-row"><span class="grow dim">${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`);
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

    if (this.demo) {
      this.demoAcc += dt;
      const step = 1 / 20;
      while (this.demoAcc >= step) {
        this.demoAcc -= step;
        const { snapshot, events } = this.demo.update(step);
        this.onSnapshot(snapshot);
        if (events.length) this.onEvents(events);
      }
    }

    // 1) zdarzenia (zawsze przed renderem snapshotu)
    this.flushEvents(now);

    // 2) stan do wyrenderowania
    const state = this.buffer.sample(now);
    this.input.update(dt);
    this.particles.update(dt);
    this.hud.update(dt);

    if (state) {
      const turn = state.turn;
      const active = state.worms.find((w) => w.id === turn.activeWormId && w.alive);
      // kamera: pocisk > aktywny robak
      if (state.projectiles.length > 0) {
        const p = state.projectiles[state.projectiles.length - 1];
        this.camera.follow(p.x, p.y);
      } else if (active) {
        this.camera.follow(active.x, active.y - 30);
      }
      this.waterShown += (turn.waterLevel - this.waterShown) * Math.min(1, dt * 2.5);
      this.input.setContext({
        myTurn: this.isMyTurn(state.turn.activeTeam, state.turn.phase),
        worm: active ?? null,
        weapon: this.selectedWeapon,
        blocked: this.panelOpen || this.escOpen || this.overOpen,
      });
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
    if (this.demo) return true;
    return activeTeam === this.myTeam && (phase === "active" || phase === "retreat");
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
        break;
      }
      case "wormDied": {
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
        break;
      }
      case "crateSpawn": {
        this.hud.banner("Zrzut zaopatrzenia!", 1.6);
        break;
      }
      case "cratePickup": {
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
      const slot = document.createElement("div");
      slot.className = "wslot";
      slot.title = WEAPON_NAMES[id];
      const c = document.createElement("canvas");
      c.width = 40;
      c.height = 40;
      const cx = c.getContext("2d");
      if (cx) {
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
        if (!this.demo) this.cb.send({ t: "action", action: { kind: "selectWeapon", weapon: id } });
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
      const infinite = n !== undefined && n < 0;
      s.ammo.textContent = n === undefined ? "" : infinite ? "∞" : String(n);
      s.el.classList.toggle("empty", n !== undefined && n === 0);
      s.el.classList.toggle("sel", id === this.selectedWeapon);
    }
  }

  private toggleWeapons(): void {
    this.setWeapons(!this.panelOpen);
  }

  private setWeapons(open: boolean): void {
    this.panelOpen = open && !this.escOpen && !this.overOpen;
    this.els.weaponPanel.hidden = !this.panelOpen;
    if (this.panelOpen) this.refreshWeaponPanel();
  }

  private toggleEsc(): void {
    if (this.overOpen) return;
    this.setEsc(!this.escOpen);
  }

  private setEsc(open: boolean): void {
    this.escOpen = open;
    this.setOverlay(this.els.escMenu, open);
    if (open) this.setWeapons(false);
  }

  private setOverlay(el: HTMLElement, open: boolean): void {
    el.hidden = !open;
  }

  private wireOverlays(): void {
    byId("btn-resume").addEventListener("click", () => this.setEsc(false));
    byId("btn-surrender").addEventListener("click", () => {
      if (!confirm("Na pewno chcesz się poddać? Twoje robaki zginą.")) return;
      if (!this.demo) this.cb.send({ t: "action", action: { kind: "surrender" } });
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

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.els.canvas.clientWidth || window.innerWidth;
    const h = this.els.canvas.clientHeight || window.innerHeight;
    this.els.canvas.width = Math.round(w * dpr);
    this.els.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.setViewport(w, h);
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Brak elementu #${id}`);
  return el as T;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
