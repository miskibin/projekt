// Postacie robaków: maszyna stanów animacji (czysta logika) + rysowanie sylwetki.
//
// `WormAnimator` trzyma stan animacji per robak (id) i jest aktualizowany raz na
// klatkę wartością dt — wszystkie timery/fazy są niezależne od liczby klatek.
// Nie dotyka DOM ani canvasu, więc da się go testować w środowisku node.
import type { WeaponId } from "@shared/protocol";

// ---------------------------------------------------------------- typy wejścia

/** Minimum, jakiego potrzebuje animator (zgodne z `WormSnapshot`). */
export interface AnimWorm {
  id: number;
  team: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  onGround?: boolean;
  facing: 1 | -1;
  hp: number;
  alive: boolean;
  /** "jetpack" | "bat" */
  anim?: string;
  aim?: number;
}

/** Obiekt, którego robak może się bać (pocisk w locie / uzbrojona mina). */
export interface AnimThreat {
  x: number;
  y: number;
}

export interface AnimWorld {
  worms: readonly AnimWorm[];
  /** pociski + tykające miny — do reakcji „strach” */
  threats: readonly AnimThreat[];
  activeWormId: number;
  activeTeam: number;
  /** faza tury (`TurnInfo.phase`) */
  phase: string;
  /** 0..1 – naciąg aktywnego robaka */
  charge: number;
}

export type WormState =
  | "idle"
  | "walk"
  | "jump"
  | "fall"
  | "land"
  | "aim"
  | "charge"
  | "recoil"
  | "hurt"
  | "scared"
  | "tired"
  | "celebrate"
  | "dead"
  | "jetpack"
  | "bat";

export type MouthKind = "smile" | "bigSmile" | "flat" | "frown" | "open" | "grit" | "wave";

/** Wynik animacji: wszystko czego potrzebuje rysowanie, w jednostkach świata. */
export interface WormPose {
  state: WormState;
  /** przesunięcie ciała względem pozycji fizycznej */
  ox: number;
  oy: number;
  /** squash & stretch */
  sx: number;
  sy: number;
  /** przechył ciała (rad, dodatni = w prawo) */
  lean: number;
  /** faza chodu 0..1 */
  step: number;
  /** 0..1 – jak mocno ugięte nóżki */
  squat: number;
  /** 0..1 – ręce uniesione */
  armsUp: number;
  /** kąt trzymanej broni (rad, w układzie „przód robaka = +x”) albo null */
  hold: number | null;
  /** rozwarcie oczu: 0 = zamknięte, 1 = normalne, >1 = szeroko */
  eyeL: number;
  eyeR: number;
  /** opadnięta powieka 0..1 (zmęczenie / mrużenie) */
  lid: number;
  /** kierunek źrenic (-1..1) */
  pupilX: number;
  pupilY: number;
  /** oczy jako „X” (ból/śmierć) */
  xEyes: number;
  /** oczy jako „^^” (radość) */
  happyEyes: number;
  /** brwi: -1 = groźne, 0 = neutralne, 1 = zmartwione */
  brow: number;
  mouth: MouthKind;
  /** 0..1 – jak szeroko otwarte usta */
  mouthOpen: number;
  /** 0..1 – rozjaśnienie ciała po trafieniu */
  flash: number;
  /** 0..1 – nadęte policzki */
  cheeks: number;
  /** 0..1 – kropla potu */
  sweat: number;
  /** przezroczystość (zanikanie po śmierci) */
  alpha: number;
  /** wychylenie czułka */
  tuft: number;
}

// ---------------------------------------------------------------- parametry

/** Prędkość pozioma, powyżej której uznajemy że robak idzie. */
export const WALK_VX = 12;
/** Promień, w którym pocisk/mina wywołuje strach. */
export const SCARE_RADIUS = 90;
/** Poniżej tylu HP robak jest zmęczony (i ma bandaż). */
export const LOW_HP = 35;

const HURT_TIME = 0.5;
const FLASH_TIME = 0.12;
const RECOIL_TIME = 0.25;
const LAND_TIME = 0.22;
const CELEBRATE_TIME = 1;
const DEATH_TIME = 0.3;
const BLINK_TIME = 0.13;
const LOOK_TIME = 0.85;
/** Wpisy robaków niewidzianych dłużej niż tyle sekund są usuwane. */
export const PRUNE_AFTER = 5;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const approach = (cur: number, target: number, dt: number, rate: number): number =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** Deterministyczny RNG (żeby mruganie było powtarzalne w testach). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Entry {
  id: number;
  team: number;
  rnd: () => number;
  /** losowe przesunięcie faz, żeby robaki nie oddychały unisono */
  phase: number;
  seen: number;
  hp: number;
  alive: boolean;
  onGround: boolean;
  /** ostatnia pozycja – chodzenie zmienia x bez vx (patrz `walkStep`) */
  lastX: number;
  /** wygładzona prędkość pozioma (px/s) */
  speed: number;
  /** największa prędkość opadania od ostatniego lądowania */
  fallSpeed: number;
  airTime: number;
  walk: number;
  breath: number;
  hurt: number;
  flash: number;
  recoil: number;
  land: number;
  landImpact: number;
  celebrate: number;
  death: number;
  blink: number;
  nextBlink: number;
  look: number;
  nextLook: number;
  lookDir: number;
  scare: number;
  pose: WormPose;
}

function blankPose(): WormPose {
  return {
    state: "idle",
    ox: 0,
    oy: 0,
    sx: 1,
    sy: 1,
    lean: 0,
    step: 0,
    squat: 0,
    armsUp: 0,
    hold: null,
    eyeL: 1,
    eyeR: 1,
    lid: 0,
    pupilX: 0,
    pupilY: 0,
    xEyes: 0,
    happyEyes: 0,
    brow: 0,
    mouth: "smile",
    mouthOpen: 0,
    flash: 0,
    cheeks: 0,
    sweat: 0,
    alpha: 1,
    tuft: 0,
  };
}

/**
 * Maszyna stanów animacji robaków. Jedna instancja na renderer.
 *
 * Kolejność priorytetów stanów (od najwyższego):
 * dead > hurt > bat > jetpack > recoil > land > jump/fall > walk > charge >
 * celebrate > aim > scared > tired > idle.
 */
export class WormAnimator {
  private entries = new Map<number, Entry>();
  private teamCheer = new Map<number, number>();
  private time = 0;
  private activeTeam = -1;

  /** Liczba śledzonych robaków (do testów/diagnostyki). */
  get size(): number {
    return this.entries.size;
  }

  reset(): void {
    this.entries.clear();
    this.teamCheer.clear();
    this.time = 0;
  }

  /** Poza policzona w ostatnim `update` (null gdy robak nieznany). */
  pose(id: number): WormPose | null {
    return this.entries.get(id)?.pose ?? null;
  }

  state(id: number): WormState | null {
    return this.entries.get(id)?.pose.state ?? null;
  }

  // ------------------------------------------------------------- zdarzenia

  /** Robak oberwał – wzdrygnięcie + błysk; drużyna sprawcy się cieszy. */
  onDamage(wormId: number, _amount = 0): void {
    const e = this.entries.get(wormId);
    if (!e) return;
    this.hurt(e);
    if (this.activeTeam >= 0 && this.activeTeam !== e.team) {
      this.teamCheer.set(this.activeTeam, CELEBRATE_TIME);
    }
  }

  /** Robak oddał strzał – odrzut. */
  onShot(wormId: number): void {
    const e = this.entries.get(wormId);
    if (e) e.recoil = RECOIL_TIME;
  }

  /** Robak zginął – krótkie zgniecenie; drużyna sprawcy świętuje dłużej. */
  onKill(wormId: number): void {
    const e = this.entries.get(wormId);
    if (!e) return;
    e.death = DEATH_TIME;
    e.alive = false;
    if (this.activeTeam >= 0 && this.activeTeam !== e.team) {
      this.teamCheer.set(this.activeTeam, CELEBRATE_TIME * 1.4);
    }
  }

  /** Podniesiona skrzynka – radosny podskok. */
  onPickup(wormId: number): void {
    const e = this.entries.get(wormId);
    if (e) e.celebrate = CELEBRATE_TIME;
  }

  /** Nowa tura – kasujemy świętowanie z poprzedniej. */
  onTurnStart(team: number): void {
    this.teamCheer.clear();
    this.activeTeam = team;
  }

  private hurt(e: Entry): void {
    e.hurt = HURT_TIME;
    e.flash = FLASH_TIME;
    e.celebrate = 0;
  }

  // ------------------------------------------------------------- aktualizacja

  update(dt: number, world: AnimWorld): void {
    const d = clamp(dt, 0, 0.1);
    this.time += d;
    this.activeTeam = world.activeTeam;

    for (const [team, t] of this.teamCheer) {
      const left = t - d;
      if (left <= 0) this.teamCheer.delete(team);
      else this.teamCheer.set(team, left);
    }

    for (const w of world.worms) {
      const e = this.entry(w);
      e.seen = this.time;
      e.team = w.team;
      this.step(e, w, world, d);
    }

    for (const [id, e] of this.entries) {
      if (this.time - e.seen > PRUNE_AFTER) this.entries.delete(id);
    }
  }

  private entry(w: AnimWorm): Entry {
    let e = this.entries.get(w.id);
    if (e) return e;
    const rnd = mulberry(w.id * 2654435761 + 12345);
    e = {
      id: w.id,
      team: w.team,
      rnd,
      phase: rnd() * Math.PI * 2,
      seen: this.time,
      hp: w.hp,
      alive: w.alive,
      onGround: w.onGround !== false,
      lastX: w.x,
      speed: 0,
      fallSpeed: 0,
      airTime: 0,
      walk: rnd(),
      breath: rnd() * Math.PI * 2,
      hurt: 0,
      flash: 0,
      recoil: 0,
      land: 0,
      landImpact: 0,
      celebrate: 0,
      death: 0,
      blink: 0,
      nextBlink: 2 + rnd() * 3,
      look: 0,
      nextLook: 3 + rnd() * 3,
      lookDir: 0,
      scare: 0,
      pose: blankPose(),
    };
    this.entries.set(w.id, e);
    return e;
  }

  /** Jeden krok: przejścia stanów + policzenie pozy. */
  private step(e: Entry, w: AnimWorm, world: AnimWorld, dt: number): void {
    const vx = w.vx ?? 0;
    const vy = w.vy ?? 0;
    const onGround = w.onGround !== false;
    const isActive = w.id === world.activeWormId;

    // chodzenie przesuwa `x` bez zmiany `vx`, więc prędkość liczymy też z pozycji
    const inst = dt > 0.0001 ? Math.min(400, Math.abs(w.x - e.lastX) / dt) : 0;
    e.lastX = w.x;
    e.speed = approach(e.speed, Math.max(Math.abs(vx), inst), dt, 18);

    // --- wykrywanie zdarzeń ze snapshotu -------------------------------
    if (w.hp < e.hp - 0.01 && w.alive) this.hurt(e);
    if (e.alive && !w.alive) e.death = DEATH_TIME;
    e.hp = w.hp;
    e.alive = w.alive;

    if (!onGround) {
      e.airTime += dt;
      e.fallSpeed = Math.max(e.fallSpeed, vy);
    } else if (!e.onGround) {
      // wylądował: siła przysiadu proporcjonalna do prędkości opadania
      if (e.airTime > 0.12) {
        e.land = LAND_TIME;
        e.landImpact = clamp(e.fallSpeed / 520, 0.25, 1);
      }
      e.airTime = 0;
      e.fallSpeed = 0;
    }
    e.onGround = onGround;

    // --- timery ---------------------------------------------------------
    e.hurt = Math.max(0, e.hurt - dt);
    e.flash = Math.max(0, e.flash - dt);
    e.recoil = Math.max(0, e.recoil - dt);
    e.land = Math.max(0, e.land - dt);
    e.celebrate = Math.max(0, e.celebrate - dt);
    e.death = Math.max(0, e.death - dt);
    e.breath += dt;
    if (e.speed > WALK_VX && onGround) e.walk = (e.walk + dt * 1.9) % 1;

    // mruganie i rozglądanie się
    if (e.blink > 0) e.blink = Math.max(0, e.blink - dt);
    else {
      e.nextBlink -= dt;
      if (e.nextBlink <= 0) {
        e.blink = BLINK_TIME;
        e.nextBlink = 2 + e.rnd() * 3;
      }
    }
    if (e.look > 0) e.look = Math.max(0, e.look - dt);
    else {
      e.nextLook -= dt;
      if (e.nextLook <= 0) {
        e.look = LOOK_TIME;
        e.lookDir = e.rnd() < 0.5 ? -1 : 1;
        e.nextLook = 3 + e.rnd() * 4;
      }
    }

    // --- strach: czy coś groźnego jest blisko ---------------------------
    let near = false;
    for (const th of world.threats) {
      const dx = th.x - w.x;
      const dy = th.y - w.y;
      if (dx * dx + dy * dy < SCARE_RADIUS * SCARE_RADIUS) {
        near = true;
        break;
      }
    }
    e.scare = approach(e.scare, near ? 1 : 0, dt, near ? 14 : 5);

    const cheer = (this.teamCheer.get(w.team) ?? 0) > 0 || e.celebrate > 0;
    const charging = isActive && world.charge > 0.02 && world.phase === "active";
    const aiming = isActive && (world.phase === "active" || world.phase === "retreat");
    const lowHp = w.hp > 0 && w.hp < LOW_HP;

    // --- wybór stanu ----------------------------------------------------
    let st: WormState;
    if (!w.alive) st = "dead";
    else if (e.hurt > 0) st = "hurt";
    else if (w.anim === "bat") st = "bat";
    else if (w.anim === "jetpack") st = "jetpack";
    else if (e.recoil > 0) st = "recoil";
    else if (e.land > 0) st = "land";
    else if (!onGround) st = vy < 0 ? "jump" : "fall";
    else if (e.speed > WALK_VX) st = "walk";
    else if (charging) st = "charge";
    else if (cheer) st = "celebrate";
    else if (aiming) st = "aim";
    else if (e.scare > 0.4) st = "scared";
    else if (lowHp) st = "tired";
    else st = "idle";

    this.buildPose(e, w, world, st, { vx, vy, isActive, aiming, lowHp, dt });
  }

  private buildPose(
    e: Entry,
    w: AnimWorm,
    world: AnimWorld,
    st: WormState,
    o: { vx: number; vy: number; isActive: boolean; aiming: boolean; lowHp: boolean; dt: number },
  ): void {
    const p = e.pose;
    const t = this.time;
    const ph = e.phase;
    const aim = w.aim ?? 0;

    // wartości bazowe
    p.state = st;
    p.ox = 0;
    p.oy = 0;
    p.lean = 0;
    p.step = e.walk;
    p.squat = 0;
    p.armsUp = 0;
    p.hold = null;
    p.lid = 0;
    p.xEyes = 0;
    p.happyEyes = 0;
    p.brow = 0;
    p.mouth = "smile";
    p.mouthOpen = 0;
    p.cheeks = 0;
    p.sweat = 0;
    p.alpha = 1;
    p.tuft = Math.sin(t * 3.4 + ph);

    // oddech – baza dla wszystkich stanów naziemnych
    const breath = Math.sin(e.breath * 2.3 + ph) * 0.035;
    let sx = 1 - breath * 0.8;
    let sy = 1 + breath;
    let eye = 1;
    let pupX = w.facing as number;
    let pupY = 0;

    switch (st) {
      case "walk": {
        const s = Math.sin(e.walk * Math.PI * 2);
        const b = Math.abs(s);
        sy = 1 + 0.075 * b;
        sx = 1 - 0.06 * b;
        p.oy = -1.5 * b;
        p.lean = w.facing * 0.11;
        p.mouthOpen = 0.25;
        p.brow = -0.15;
        break;
      }
      case "jump": {
        const k = clamp(-o.vy / 320, 0, 1);
        sy = 1 + 0.2 * k;
        sx = 1 / sy;
        p.armsUp = 1;
        eye = 1.25;
        p.mouth = "open";
        p.mouthOpen = 0.75;
        p.brow = 0.5;
        pupY = -0.4;
        break;
      }
      case "fall": {
        const k = clamp(o.vy / 520, 0, 1);
        sy = 1 - 0.1 * k;
        sx = 1 + 0.09 * k;
        p.armsUp = 0.55 + 0.35 * k;
        p.squat = 0.5 * k;
        eye = 1.15 + 0.15 * k;
        p.mouth = "open";
        p.mouthOpen = 0.5 + 0.4 * k;
        p.brow = 0.8;
        pupY = 0.35;
        break;
      }
      case "land": {
        const k = (e.land / LAND_TIME) * e.landImpact;
        sy = 1 - 0.3 * k;
        sx = 1 + 0.28 * k;
        p.oy = 0.6 * k;
        p.squat = k;
        eye = 1 - 0.8 * k;
        p.mouth = "flat";
        p.brow = -0.4;
        break;
      }
      case "aim": {
        p.hold = aim;
        p.lean = -w.facing * (0.05 + Math.max(0, -aim) * 0.13);
        // oko od strony celu przymrużone
        p.lid = 0.25;
        p.brow = -0.55;
        p.mouth = "flat";
        pupX = Math.cos(aim) * w.facing;
        pupY = Math.sin(aim);
        break;
      }
      case "charge": {
        const c = clamp(world.charge, 0, 1);
        p.hold = aim;
        p.ox = Math.sin(t * 47 + ph) * 1.15 * c;
        p.oy = Math.cos(t * 53 + ph) * 0.8 * c;
        p.lean = -w.facing * (0.05 + Math.max(0, -aim) * 0.13);
        sy = 1 - 0.05 * c;
        sx = 1 + 0.06 * c;
        p.cheeks = c;
        eye = 1 - 0.45 * c;
        p.brow = -1;
        p.mouth = "grit";
        pupX = Math.cos(aim) * w.facing;
        pupY = Math.sin(aim);
        break;
      }
      case "recoil": {
        const k = e.recoil / RECOIL_TIME;
        p.ox = -w.facing * 5 * k;
        p.lean = w.facing * 0.3 * k;
        sx = 1 + 0.12 * k;
        sy = 1 - 0.1 * k;
        eye = 1 + 0.35 * k;
        p.mouth = "open";
        p.mouthOpen = k;
        p.brow = -0.8;
        p.hold = o.aiming ? aim : null;
        p.armsUp = 0.2;
        break;
      }
      case "hurt": {
        const k = e.hurt / HURT_TIME;
        p.ox = Math.sin(t * 44 + ph) * 2 * k;
        p.lean = Math.sin(t * 38 + ph) * 0.26 * k;
        sy = 1 - 0.12 * k;
        sx = 1 + 0.12 * k;
        p.xEyes = k > 0.45 ? 1 : 0;
        eye = 0.35;
        p.mouth = "wave";
        p.mouthOpen = 0.8;
        p.brow = 1;
        p.armsUp = 0.7 * k;
        p.flash = e.flash / FLASH_TIME;
        break;
      }
      case "scared": {
        const k = e.scare;
        p.ox = Math.sin(t * 31 + ph) * 0.9 * k;
        p.oy = Math.sin(t * 27 + ph * 2) * 0.6 * k;
        eye = 1 + 0.35 * k;
        p.brow = 1;
        p.mouth = "wave";
        p.mouthOpen = 0.45;
        p.sweat = k > 0.6 ? 1 : 0;
        break;
      }
      case "celebrate": {
        const hop = Math.abs(Math.sin(t * 7.5 + ph));
        p.oy = -4.5 * hop;
        sy = 1 + 0.09 * hop;
        sx = 1 - 0.07 * hop;
        p.armsUp = 0.85;
        p.happyEyes = 1;
        p.mouth = "bigSmile";
        p.mouthOpen = 0.8;
        // strzelec nie odkłada broni w trakcie świętowania
        if (o.aiming) p.hold = aim;
        break;
      }
      case "tired": {
        p.oy = 0.9;
        sy = 0.965;
        sx = 1.03;
        p.lid = 0.55;
        eye = 0.85;
        p.brow = 0.7;
        p.mouth = "frown";
        // kropla potu co ~3 s
        p.sweat = ((t * 0.33 + ph) % 1) < 0.3 ? 1 : 0;
        pupY = 0.25;
        break;
      }
      case "dead": {
        const k = e.death / DEATH_TIME;
        sy = 0.35 + 0.65 * k;
        sx = 1.5 - 0.5 * k;
        p.oy = (1 - k) * 4;
        p.alpha = k;
        p.xEyes = 1;
        p.mouth = "wave";
        break;
      }
      case "jetpack": {
        p.armsUp = 0.35;
        p.squat = 0.4;
        sy = 1.04;
        sx = 0.98;
        eye = 1.15;
        p.mouth = "open";
        p.mouthOpen = 0.4;
        p.oy = Math.sin(t * 9 + ph) * 0.6;
        break;
      }
      case "bat": {
        p.lean = w.facing * 0.18;
        p.armsUp = 0.9;
        eye = 1.1;
        p.brow = -1;
        p.mouth = "grit";
        break;
      }
      default: {
        // idle
        if (e.look > 0) {
          pupX = e.lookDir;
          pupY = -0.15;
        }
        p.mouthOpen = 0.1;
      }
    }

    // --- modyfikatory nakładane na stan bazowy ---------------------------
    if (o.lowHp && (st === "idle" || st === "walk" || st === "aim")) {
      p.lid = Math.max(p.lid, 0.4);
      p.oy += 0.5;
      if (st === "idle") {
        p.mouth = "frown";
        p.sweat = ((t * 0.33 + ph) % 1) < 0.25 ? 1 : 0;
      }
    }
    if (e.scare > 0.05 && st !== "scared" && st !== "hurt" && st !== "dead") {
      p.ox += Math.sin(t * 31 + ph) * 0.7 * e.scare;
      eye += 0.25 * e.scare;
      p.brow = Math.max(p.brow, e.scare);
    }
    if (st !== "hurt") p.flash = e.flash / FLASH_TIME;

    // mruganie – tylko gdy oczy „normalne”
    let blinkK = 0;
    if (e.blink > 0) {
      const q = 1 - Math.abs(e.blink / BLINK_TIME - 0.5) * 2;
      blinkK = clamp(q * 1.6, 0, 1);
    }
    const open = clamp(eye, 0, 1.6) * (1 - blinkK);
    p.eyeL = open;
    p.eyeR = open;
    // przy celowaniu robak mruży oko od strony broni
    if (st === "aim" || st === "charge") {
      if (w.facing > 0) p.eyeR = open * 0.72;
      else p.eyeL = open * 0.72;
    }

    p.pupilX = clamp(pupX, -1, 1);
    p.pupilY = clamp(pupY, -1, 1);
    p.sx = sx;
    p.sy = sy;
  }
}

/** Pomocnicze: czy robak powinien mieć bandaż. */
export function isLowHp(hp: number): boolean {
  return hp > 0 && hp < LOW_HP;
}

// ============================================================================
//                              R Y S O W A N I E
// ============================================================================

/** Pół-szerokość / pół-wysokość ciała (świat). Stopy na y ≈ +RY. */
/** Większa, czytelna sylwetka inspirowana proporcjami klasycznych Wormsów. Hitbox pozostaje w silniku bez zmian. */
export const WORM_RX = 13.5;
export const WORM_RY = 15.9;
/** Dolna krawędź postaci względem środka fizycznego — utrzymuje stopy na starej linii gruntu. */
export const WORM_GROUND_OFFSET = 12.8;

const EYE_RX = 3.7;
const EYE_RY = 4.15;

export interface WormSkin {
  base: string;
  light: string;
  mid: string;
  dark: string;
  line: string;
  belly: string;
  bodyGrad: CanvasGradient | null;
}

/** Cache barw i gradientów per kolor drużyny (bez alokacji co klatkę). */
export class WormSkins {
  private map = new Map<string, WormSkin>();
  private ctx: CanvasRenderingContext2D | null = null;

  get(ctx: CanvasRenderingContext2D, color: string): WormSkin {
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      this.map.clear();
    }
    let s = this.map.get(color);
    if (s) return s;
    s = {
      base: color,
      light: lighten(color, 0.58),
      mid: lighten(color, 0.16),
      dark: darken(color, 0.36),
      line: darken(color, 0.6),
      belly: lighten(color, 0.66),
      bodyGrad: null,
    };
    // gradient w lokalnym układzie robaka – ważny jest transform w chwili malowania,
    // więc jeden obiekt obsługuje wszystkie robaki tej drużyny
    const g = ctx.createLinearGradient(-WORM_RX, -WORM_RY, WORM_RX, WORM_RY);
    g.addColorStop(0, s.light);
    g.addColorStop(0.38, s.mid);
    g.addColorStop(0.72, s.base);
    g.addColorStop(1, s.dark);
    s.bodyGrad = g;
    this.map.set(color, s);
    return s;
  }
}

export interface WormDrawOpts {
  skin: WormSkin;
  facing: 1 | -1;
  /** broń w rękach (null = brak) */
  weapon: WeaponId | null;
  hp: number;
  time: number;
  /** rysuj plecak odrzutowy */
  jetpack: boolean;
  /** rysuj kij baseballowy w zamachu */
  bat: boolean;
}

/**
 * Rysuje postać w lokalnym układzie (0,0 = środek fizyczny robaka).
 * Wywołujący ustawia translate na pozycję robaka.
 */
export function drawWormCharacter(ctx: CanvasRenderingContext2D, p: WormPose, o: WormDrawOpts): void {
  const { skin, facing } = o;
  const rx = WORM_RX;
  const ry = WORM_RY;

  ctx.save();
  if (p.alpha < 1) ctx.globalAlpha = p.alpha;
  ctx.translate(p.ox, p.oy);

  if (o.jetpack) drawJetpack(ctx, facing, ry, o.time);

  // kolejność: tylna ręka -> nóżki -> ciało z twarzą -> broń -> przednia ręka
  const back = armGeom(p, o, -1, rx);
  const front = armGeom(p, o, 1, rx);
  drawLimb(ctx, o, back);
  drawFeet(ctx, p, o, rx, ry);

  ctx.save();
  if (p.lean !== 0) ctx.rotate(p.lean);
  ctx.scale(p.sx, p.sy);

  bodyPath(ctx, rx, ry);
  ctx.fillStyle = skin.bodyGrad ?? skin.base;
  ctx.fill();

  // jasny brzuszek
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = skin.belly;
  ctx.beginPath();
  ctx.ellipse(facing * 0.6, ry * 0.5, rx * 0.66, ry * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Subtle belly segments and a side highlight give the animated body volume.
  ctx.strokeStyle = skin.dark;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 0.85;
  for (let y = 5; y < 14; y += 3) {
    ctx.beginPath();
    ctx.moveTo(-rx * 0.48, y);
    ctx.quadraticCurveTo(0, y + 2, rx * 0.48, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = skin.belly;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-rx * 0.75, -ry * 0.45);
  ctx.quadraticCurveTo(-rx * 0.96, 0, -rx * 0.65, ry * 0.38);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // bandaż przy niskim hp
  if (isLowHp(o.hp)) {
    ctx.fillStyle = "#f2ece0";
    ctx.save();
    ctx.translate(0, 2.4);
    ctx.rotate(-0.42);
    ctx.fillRect(-rx - 4, -2.5, (rx + 4) * 2, 5);
    ctx.strokeStyle = "rgba(0,0,0,0.13)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-rx - 4, -2.5, (rx + 4) * 2, 5);
    ctx.restore();
  }

  // błysk po trafieniu
  if (p.flash > 0.001) {
    ctx.globalAlpha = 0.85 * p.flash;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-rx - 2, -ry - 2, (rx + 2) * 2, (ry + 2) * 2);
    ctx.globalAlpha = 1;
  }
  ctx.restore(); // clip

  // kontur
  bodyPath(ctx, rx, ry);
  ctx.strokeStyle = skin.line;
  ctx.lineWidth = 1.55;
  ctx.lineJoin = "round";
  ctx.stroke();

  // połysk
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(-facing * 3.6, -ry * 0.62, 2.8, 1.9, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // czułek
  const wig = p.tuft;
  ctx.strokeStyle = skin.line;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-facing * 0.4, -ry + 0.6);
  ctx.quadraticCurveTo(-facing * 1.4, -ry - 3.6, -facing * 3.2 + wig * 0.5, -ry - 6 + wig * 0.25);
  ctx.stroke();
  ctx.fillStyle = skin.line;
  ctx.beginPath();
  ctx.arc(-facing * 3.2 + wig * 0.5, -ry - 6 + wig * 0.25, 1.35, 0, Math.PI * 2);
  ctx.fill();

  drawFace(ctx, p, o, rx, ry);
  ctx.restore(); // skala ciała

  if (p.hold !== null && o.weapon) {
    ctx.save();
    ctx.translate(facing * rx * 0.5, 3.2);
    ctx.scale(facing, 1);
    ctx.rotate(p.hold);
    drawHeldWeapon(ctx, o.weapon);
    ctx.restore();
  }
  drawLimb(ctx, o, front);

  if (o.bat) drawBat(ctx, facing, o.time);
  if (p.sweat > 0.5) drawSweat(ctx, facing, rx, ry, o.time);

  ctx.restore();
}

/** Dwie krótkie stopki wystające na boki u dołu sylwetki. */
function drawFeet(ctx: CanvasRenderingContext2D, p: WormPose, o: WormDrawOpts, rx: number, ry: number): void {
  const squish = 1 - 0.4 * p.squat;
  const airborne = p.state === "jump" || p.state === "fall" || p.state === "jetpack";
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    let fx = s * rx * 0.6 * p.sx;
    let fy = ry * 0.92 * p.sy;
    if (p.state === "walk") {
      const a = p.step * Math.PI * 2 + (i === 0 ? 0 : Math.PI);
      fx += Math.cos(a) * 2 * o.facing;
      fy -= Math.max(0, Math.sin(a)) * 2.4;
    } else if (airborne) {
      fx += s * 0.8;
      fy -= 0.8;
    }
    ctx.fillStyle = o.skin.dark;
    ctx.beginPath();
    ctx.ellipse(fx, fy, 3.5, 2.5 * squish, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = o.skin.line;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
}

/** Twarz: oczy, brwi, usta, policzki. Rysowane w układzie przeskalowanego ciała. */
function drawFace(ctx: CanvasRenderingContext2D, p: WormPose, o: WormDrawOpts, rx: number, ry: number): void {
  const facing = o.facing;
  const eyeY = -ry * 0.26;
  const cx = facing * 1.4;
  const gap = 3.4;

  // oczy
  drawEye(ctx, cx - gap, eyeY, p.eyeL, p, o);
  drawEye(ctx, cx + gap, eyeY, p.eyeR, p, o);

  // brwi
  if (p.happyEyes < 0.5 && p.xEyes < 0.5) {
    ctx.strokeStyle = o.skin.line;
    ctx.lineWidth = 1.15;
    ctx.lineCap = "round";
    const browY = eyeY - EYE_RY - 1.1;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      // brow: -1 groźne (wewnętrzny koniec niżej), +1 zmartwione (wewnętrzny wyżej)
      const inner = s * (gap - 1.9);
      const outer = s * (gap + 1.9);
      const tilt = 1.3 * p.brow;
      ctx.beginPath();
      ctx.moveTo(cx + inner, browY - tilt);
      ctx.lineTo(cx + outer, browY + tilt);
      ctx.stroke();
    }
  }

  // policzki (naładowanie / radość)
  if (p.cheeks > 0.05 || p.happyEyes > 0.5) {
    const a = p.happyEyes > 0.5 ? 0.4 : 0.28 + 0.32 * p.cheeks;
    const r = 1.7 + 0.9 * p.cheeks;
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ff8a8a";
    ctx.beginPath();
    ctx.ellipse(cx - gap - 2.2, eyeY + 3.2, r, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + gap + 2.2, eyeY + 3.2, r, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawMouth(ctx, p, o, cx, eyeY + 4.9);
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  open: number,
  p: WormPose,
  o: WormDrawOpts,
): void {
  const line = o.skin.line;
  if (p.xEyes > 0.5) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x, y, EYE_RX, EYE_RY * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20,24,32,0.32)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.strokeStyle = "#141a24";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    const r = 2.1;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
    return;
  }
  if (p.happyEyes > 0.5) {
    ctx.strokeStyle = "#141a24";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y + 1.4, 2.6, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  if (open < 0.1) {
    ctx.strokeStyle = "#141a24";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - EYE_RX * 0.85, y);
    ctx.quadraticCurveTo(x, y + 1.1, x + EYE_RX * 0.85, y);
    ctx.stroke();
    return;
  }

  const ry = EYE_RY * Math.min(open, 1.35);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x, y, EYE_RX, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.clip();
  const px = x + p.pupilX * (EYE_RX - 1.5);
  const py = y + p.pupilY * Math.max(0.2, ry - 1.6);
  ctx.fillStyle = "#141a24";
  ctx.beginPath();
  ctx.arc(px, py, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(px - 0.6, py - 0.7, 0.62, 0, Math.PI * 2);
  ctx.fill();
  // powieka
  if (p.lid > 0.02) {
    ctx.fillStyle = line;
    ctx.fillRect(x - EYE_RX - 0.5, y - ry - 0.5, EYE_RX * 2 + 1, (ry * 2 + 1) * p.lid * 0.55);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(20,24,32,0.32)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(x, y, EYE_RX, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawMouth(ctx: CanvasRenderingContext2D, p: WormPose, o: WormDrawOpts, cx: number, my: number): void {
  const line = o.skin.line;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.15;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (p.mouth) {
    case "bigSmile": {
      ctx.fillStyle = "#3a1f24";
      ctx.beginPath();
      ctx.moveTo(cx - 3.1, my - 0.6);
      ctx.quadraticCurveTo(cx, my + 3.4 + p.mouthOpen * 1.4, cx + 3.1, my - 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff9aa2";
      ctx.beginPath();
      ctx.ellipse(cx, my + 1.9 + p.mouthOpen * 0.6, 1.5, 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "open": {
      ctx.fillStyle = "#3a1f24";
      ctx.beginPath();
      ctx.ellipse(cx, my + 0.3, 1.5 + p.mouthOpen * 0.6, 1.2 + p.mouthOpen * 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "grit": {
      ctx.fillStyle = "#f4f1ea";
      roundRect(ctx, cx - 3, my - 1, 6, 2.4, 0.8);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 1, my - 1);
      ctx.lineTo(cx - 1, my + 1.4);
      ctx.moveTo(cx + 1, my - 1);
      ctx.lineTo(cx + 1, my + 1.4);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      break;
    }
    case "wave": {
      ctx.beginPath();
      ctx.moveTo(cx - 3, my);
      ctx.quadraticCurveTo(cx - 1.5, my - 1.6, cx, my);
      ctx.quadraticCurveTo(cx + 1.5, my + 1.6, cx + 3, my);
      ctx.stroke();
      break;
    }
    case "frown": {
      ctx.beginPath();
      ctx.arc(cx, my + 2.6, 2.2, Math.PI * 1.25, Math.PI * 1.75);
      ctx.stroke();
      break;
    }
    case "flat": {
      ctx.beginPath();
      ctx.moveTo(cx - 2.2, my);
      ctx.lineTo(cx + 2.2, my);
      ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(cx, my - 0.5, 2.3, 0.32, Math.PI - 0.32);
      ctx.stroke();
    }
  }
}

interface ArmGeom {
  sx: number;
  sy: number;
  hx: number;
  hy: number;
}

/** Punkt barku i dłoni. `side` -1 = tylna ręka, 1 = przednia. */
function armGeom(p: WormPose, o: WormDrawOpts, side: -1 | 1, rx: number): ArmGeom {
  const f = o.facing;
  const sx = f * side * rx * 0.72 * p.sx;
  const sy = 2.4 * p.sy;
  if (p.hold !== null) {
    // obie ręce na broni – punkt chwytu przed ciałem
    const grip = side > 0 ? 6.5 : 3.2;
    const gx = f * rx * 0.5;
    const gy = 3.2;
    return { sx, sy, hx: gx + f * Math.cos(p.hold) * grip, hy: gy + Math.sin(p.hold) * grip };
  }
  const a = 1.35 - p.armsUp * 2.7;
  const len = 5.2;
  return { sx, sy, hx: sx + f * side * Math.cos(a) * len, hy: sy + Math.sin(a) * len };
}

function drawLimb(ctx: CanvasRenderingContext2D, o: WormDrawOpts, g: ArmGeom): void {
  const mx = (g.sx + g.hx) / 2;
  const my = (g.sy + g.hy) / 2 - 0.8;
  // ciemny obrys pod spodem – rączka czytelna na tle ciała
  ctx.lineCap = "round";
  ctx.strokeStyle = o.skin.line;
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(g.sx, g.sy);
  ctx.quadraticCurveTo(mx, my, g.hx, g.hy);
  ctx.stroke();
  ctx.strokeStyle = o.skin.mid;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(g.sx, g.sy);
  ctx.quadraticCurveTo(mx, my, g.hx, g.hy);
  ctx.stroke();
  // dłoń
  ctx.fillStyle = o.skin.light;
  ctx.beginPath();
  ctx.arc(g.hx, g.hy, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = o.skin.line;
  ctx.lineWidth = 0.9;
  ctx.stroke();
}

/** Sylwetka broni: lufa wzdłuż +x, chwyt w (0,0). */
export function drawHeldWeapon(ctx: CanvasRenderingContext2D, weapon: WeaponId): void {
  ctx.lineJoin = "round";
  switch (weapon) {
    case "bazooka":
    case "homing": {
      const homing = weapon === "homing";
      ctx.fillStyle = homing ? "#b1263f" : "#4d5563";
      roundRect(ctx, -2, homing ? -2.2 : -1.8, homing ? 17 : 14, homing ? 4.4 : 3.6, 1.8);
      ctx.fill();
      ctx.strokeStyle = "rgba(10,14,20,0.6)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = "#2c333d";
      roundRect(ctx, homing ? 12.5 : 10.5, homing ? -2.8 : -2.2, 2.4, homing ? 5.6 : 4.4, 1);
      ctx.fill();
      ctx.fillStyle = homing ? "#7cecff" : "#9aa6b8";
      roundRect(ctx, 2, -3.2, 3.6, 1.6, 0.7);
      ctx.fill();
      if (homing) {
        ctx.fillStyle = "#eafdff";
        ctx.beginPath();
        ctx.arc(15.2, 0, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#66eaff";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(5, -2.2); ctx.lineTo(2, -5.3);
        ctx.moveTo(5, 2.2); ctx.lineTo(2, 5.3);
        ctx.stroke();
      }
      break;
    }
    case "shotgun": {
      ctx.fillStyle = "#3d444f";
      roundRect(ctx, 1, -1.5, 14, 3, 1.2);
      ctx.fill();
      ctx.fillStyle = "#7a4a24";
      roundRect(ctx, -3.5, -1.2, 5.5, 3.4, 1.2);
      ctx.fill();
      ctx.fillStyle = "#5e3616";
      roundRect(ctx, 4, 1.2, 4.5, 2.2, 0.9);
      ctx.fill();
      break;
    }
    case "uzi": {
      ctx.fillStyle = "#2f353f";
      roundRect(ctx, 0, -2, 9, 3.6, 1.2);
      ctx.fill();
      roundRect(ctx, 9, -1, 4.5, 1.8, 0.8);
      ctx.fill();
      ctx.fillStyle = "#454c58";
      roundRect(ctx, 2, 1.4, 2.6, 5, 0.8);
      ctx.fill();
      break;
    }
    case "grenade":
    case "cluster": {
      if (weapon === "cluster") {
        ctx.fillStyle = "#168c86";
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          const x = 4 + Math.cos(a) * 4.6;
          const y = Math.sin(a) * 4.6;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#8effe9";
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.fillStyle = "#ffe65c";
        ctx.fillRect(0, -0.8, 8, 1.6);
      } else {
        ctx.fillStyle = "#3f7a3a";
        ctx.beginPath();
        ctx.arc(4, 0, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#1e3a24";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.fillStyle = "#9aa0a8";
      roundRect(ctx, 3, -6, 2, 3, 0.6);
      ctx.fill();
      break;
    }
    case "banana": {
      ctx.strokeStyle = "#e0b52a";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(4, 1, 4.4, -Math.PI * 0.9, -Math.PI * 0.1);
      ctx.stroke();
      break;
    }
    case "holy": {
      ctx.fillStyle = "#f0d070";
      ctx.beginPath();
      ctx.arc(4.5, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8a6a12";
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = "#8a6a12";
      ctx.fillRect(4, -3.4, 1.1, 5);
      ctx.fillRect(2.6, -1.6, 3.8, 1.1);
      break;
    }
    case "dynamite": {
      ctx.fillStyle = "#c8382a";
      roundRect(ctx, 2, -5, 4, 10, 1.4);
      ctx.fill();
      ctx.fillStyle = "#f2e2c2";
      ctx.fillRect(2, -1.4, 4, 2.2);
      ctx.strokeStyle = "#c9a24a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(4, -5);
      ctx.quadraticCurveTo(7, -8, 5.5, -9.5);
      ctx.stroke();
      break;
    }
    case "mine": {
      ctx.fillStyle = "#6b7280";
      roundRect(ctx, 1, -3, 8, 6, 2);
      ctx.fill();
      ctx.fillStyle = "#ff3b30";
      ctx.beginPath();
      ctx.arc(5, -1, 1.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "airstrike": {
      ctx.fillStyle = "#2f3742";
      roundRect(ctx, 1, -3.5, 6, 7, 1.4);
      ctx.fill();
      ctx.strokeStyle = "#9aa6b8";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(5, -3.5);
      ctx.lineTo(8, -9);
      ctx.stroke();
      ctx.fillStyle = "#ff5f56";
      ctx.beginPath();
      ctx.arc(8, -9.4, 1.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "teleport": {
      ctx.fillStyle = "rgba(150,110,255,0.85)";
      ctx.beginPath();
      ctx.arc(4.5, 0, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(230,215,255,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(4.5, 0, 5, 2, 0.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "girder": {
      ctx.fillStyle = "#c4713a";
      roundRect(ctx, 1, -1.8, 13, 3.6, 1);
      ctx.fill();
      ctx.strokeStyle = "rgba(60,30,10,0.5)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

function drawJetpack(ctx: CanvasRenderingContext2D, facing: number, ry: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const fl = 0.8 + Math.sin(time * 33) * 0.2;
  ctx.fillStyle = "rgba(255,186,70,0.26)";
  ctx.beginPath();
  ctx.arc(0, ry + 5 * fl, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,236,170,0.45)";
  ctx.beginPath();
  ctx.arc(0, ry + 3.5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#4b5563";
  roundRect(ctx, -facing * 12, -6, 5, 12, 2);
  ctx.fill();
  ctx.fillStyle = "#2f3742";
  roundRect(ctx, -facing * 12, -1, 5, 3, 1);
  ctx.fill();
}

function drawBat(ctx: CanvasRenderingContext2D, facing: number, time: number): void {
  ctx.save();
  ctx.rotate(facing * (-0.9 + Math.sin(time * 22) * 0.7));
  ctx.fillStyle = "#b5793a";
  roundRect(ctx, 0, -2, facing * 20, 4, 2);
  ctx.fill();
  ctx.fillStyle = "#8a5a28";
  roundRect(ctx, 0, -1.6, facing * 6, 3.2, 1.5);
  ctx.fill();
  ctx.restore();
}

function drawSweat(ctx: CanvasRenderingContext2D, facing: number, rx: number, ry: number, time: number): void {
  const t = (time * 0.9) % 1;
  const x = -facing * (rx * 0.72);
  const y = -ry * 0.35 + t * 8;
  ctx.globalAlpha = 0.8 * (1 - t);
  ctx.fillStyle = "#9fd8ff";
  ctx.beginPath();
  ctx.moveTo(x, y - 2.4);
  ctx.quadraticCurveTo(x + 1.7, y + 0.6, x, y + 1.8);
  ctx.quadraticCurveTo(x - 1.7, y + 0.6, x, y - 2.4);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Pękata kropla/jajko: węższa u góry, szeroka u dołu. */
export function bodyPath(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -ry);
  ctx.bezierCurveTo(rx * 0.95, -ry * 0.96, rx * 1.06, ry * 0.34, rx * 0.66, ry * 0.88);
  ctx.bezierCurveTo(rx * 0.34, ry * 1.14, -rx * 0.34, ry * 1.14, -rx * 0.66, ry * 0.88);
  ctx.bezierCurveTo(-rx * 1.06, ry * 0.34, -rx * 0.95, -ry * 0.96, 0, -ry);
  ctx.closePath();
}

// ---------------------------------------------------------------- narzędzia

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${mix(r, 255, amt)},${mix(g, 255, amt)},${mix(b, 255, amt)})`;
}

export function darken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${mix(r, 0, amt)},${mix(g, 0, amt)},${mix(b, 0, amt)})`;
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
