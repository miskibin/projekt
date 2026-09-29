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
  lastY: number;
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
  startle: number;
  startleDir: number;
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

  /** Krótkie, lokalne zaskoczenie wybuchem. Nie zmienia fizyki ani sieci. */
  onExplosion(x: number, y: number, radius: number): void {
    for (const e of this.entries.values()) {
      if (!e.alive || Math.hypot(e.lastX - x, e.lastY - y) > radius + 90) continue;
      e.startle = 0.85;
      e.startleDir = Math.sign(x - e.lastX);
    }
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
      lastY: w.y,
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
      startle: 0,
      startleDir: 0,
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
    e.lastY = w.y;
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
    e.startle = Math.max(0, e.startle - dt);
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
    else if (e.scare > 0.4 || e.startle > 0) st = "scared";
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
        // Krótkie ziewnięcie podczas czekania na swoją turę; faza zależy od robaka.
        const yawn = (t + ph * 2) % 17;
        if (yawn < 0.75 && e.scare < 0.1 && !o.lowHp) {
          eye = 0.5;
          p.mouth = "open";
          p.mouthOpen = 0.85;
          p.armsUp = 0.55;
          p.oy = -0.8 * Math.sin(yawn / 0.75 * Math.PI);
        } else p.mouthOpen = 0.1;
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

    if (e.startle > 0 && st !== "hurt" && st !== "dead" && st !== "charge") {
      // Nawet robak, który akurat idzie, przez moment ogląda wybuch z niedowierzaniem.
      p.mouth = "open";
      p.mouthOpen = 0.75;
      p.brow = 1;
      p.sweat = e.startle > 0.35 ? 1 : 0;
      eye = Math.max(eye, 1.3);
      pupX = e.startleDir;
    }

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
    if (e.startle > 0 && st !== "hurt" && st !== "dead" && st !== "charge") {
      p.eyeL = open;
      p.eyeR = open * 0.74;
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

/** Sylwetka jest większa od hitboxu; środek fizyczny pozostaje w tym samym miejscu. */
export const WORM_RX = 13.2;
export const WORM_RY = 20;
/** Stopy kończą się na dolnej granicy fizycznego hitboxu, czyli na gruncie. */
export const WORM_GROUND_OFFSET = 8;

export type WormHat = "none" | "cap" | "bucket" | "party" | "crown";

/** Ten sam robak ma ten sam wygląd u obu graczy, ale nowy seed zmienia obsadę. */
export function hatForWorm(seed: number, id: number): WormHat {
  let h = (seed ^ Math.imul(id, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  const slot = (h ^ (h >>> 16)) >>> 0;
  return (["none", "none", "cap", "none", "bucket", "none", "party", "none", "crown", "none", "none"] as const)[slot % 11];
}

const EYE_RX = 3.75;
const EYE_RY = 4.4;
/** Wspólny atrament konturu rekwizytów i broni (ciepła, prawie czarna kreska z makiety). */
export const INK = "#1c1519";
const HAND = "#cf9c5e";
const HAIR = "#3d2617";

export interface WormSkin {
  /** kolor ciała (przygaszony kolor drużyny) */
  base: string;
  /** pas cienia po stronie odwróconej od światła */
  shade: string;
  /** jaśniejszy brzuszek */
  belly: string;
  /** nóżki */
  foot: string;
  /** kontur w odcieniu drużyny, prawie czarny */
  ink: string;
}

/** Cache barw per kolor drużyny (bez alokacji co klatkę). */
export class WormSkins {
  private map = new Map<string, WormSkin>();

  get(_ctx: CanvasRenderingContext2D, color: string): WormSkin {
    let s = this.map.get(color);
    if (s) return s;
    const [r, g, b] = hexToRgb(color);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const soft = (v: number): number => mix(mix(v, lum, 0.16), 255, 0.08);
    const body: [number, number, number] = [soft(r), soft(g), soft(b)];
    const toward = (to: number, t: number): string =>
      `rgb(${mix(body[0], to, t)},${mix(body[1], to, t)},${mix(body[2], to, t)})`;
    s = {
      base: `rgb(${body[0]},${body[1]},${body[2]})`,
      shade: toward(0, 0.14),
      belly: toward(255, 0.3),
      foot: toward(0, 0.22),
      ink: darken(color, 0.8),
    };
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
  /** Detal losowany z seeda meczu; nie daje żadnej przewagi. */
  hat?: WormHat;
}

/** Pozycje dłoni w układzie broni: [tylna x, y, przednia x, y]. */
const HANDS: Partial<Record<WeaponId, [number, number, number, number]>> = {
  bazooka: [-6, 1.5, 6, 1.5],
  homing: [-6, 1.5, 6, 1.5],
  shotgun: [-9, 3, 6, 2],
  uzi: [-2, 4, 5, 1],
  grenade: [2, 1, 6, 1],
  cluster: [2, 1, 6, 1],
  holy: [2, 1, 6, 1],
  banana: [2, 1, 6, 1],
  dynamite: [3, 1, 5, 1],
  mine: [0, 2, 7, 2],
  spring: [0, 2, 7, 2],
  drill: [-6, 2, 4, 2],
  axe: [1, 4, 5, -2],
  airstrike: [1, 3, 5, 3],
  teleport: [1, 2, 6, 2],
  girder: [1, 2, 10, 2],
};
const DEFAULT_HANDS: [number, number, number, number] = [-3, 2, 5, 2];

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

  drawFeet(ctx, p, o, rx, ry);

  ctx.save();
  if (p.lean !== 0) ctx.rotate(p.lean);
  ctx.scale(p.sx, p.sy);

  // ciało: kolor główny + pas cienia z prawej (światło pada z lewej góry) + brzuszek
  bodyPath(ctx, rx, ry);
  ctx.fillStyle = skin.shade;
  ctx.fill();
  ctx.save();
  bodyPath(ctx, rx, ry);
  ctx.clip();
  ctx.save();
  ctx.translate(-3.6, -0.6);
  bodyPath(ctx, rx, ry);
  ctx.fillStyle = skin.base;
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = p.alpha < 1 ? p.alpha * 0.6 : 0.6;
  ctx.fillStyle = skin.belly;
  ctx.beginPath();
  ctx.ellipse(-facing * 0.9 - 1.2, ry * 0.46, 7.4, 7.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = p.alpha < 1 ? p.alpha : 1;

  if (isLowHp(o.hp)) {
    ctx.save();
    ctx.translate(0, 3.4);
    ctx.rotate(-0.34);
    ctx.fillStyle = "#efe6d0";
    ctx.fillRect(-rx - 4, -2.6, (rx + 4) * 2, 5.2);
    ctx.strokeStyle = skin.ink;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-rx - 4, -2.6);
    ctx.lineTo(rx + 4, -2.6);
    ctx.moveTo(-rx - 4, 2.6);
    ctx.lineTo(rx + 4, 2.6);
    ctx.stroke();
    ctx.restore();
  }

  if (p.flash > 0.001) {
    ctx.globalAlpha = 0.85 * p.flash;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-rx - 2, -ry - 2, (rx + 2) * 2, (ry + 2) * 2);
    ctx.globalAlpha = p.alpha < 1 ? p.alpha : 1;
  }
  ctx.restore(); // clip

  bodyPath(ctx, rx, ry);
  ctx.strokeStyle = skin.ink;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  if (o.hat && o.hat !== "none") drawHat(ctx, o.hat, o);
  else drawSprout(ctx, facing, ry, p.tuft);

  drawFace(ctx, p, o, rx, ry);
  ctx.restore(); // skala ciała

  if (p.hold !== null && o.weapon) {
    ctx.save();
    ctx.translate(facing * 5, 8.5);
    ctx.scale(facing, 1);
    ctx.rotate(p.hold);
    const hands = HANDS[o.weapon] ?? DEFAULT_HANDS;
    drawHand(ctx, hands[0], hands[1]);
    drawHeldWeapon(ctx, o.weapon);
    drawHand(ctx, hands[2], hands[3]);
    ctx.restore();
  } else if (p.armsUp > 0.12) {
    const lift = p.armsUp;
    for (const s of [-1, 1]) drawHand(ctx, s * (rx + 2.5 + lift * 2), 3 - lift * 17);
  }

  if (o.bat) drawBat(ctx, facing, o.time);
  if (p.sweat > 0.5) drawSweat(ctx, facing, rx, ry, o.time);

  ctx.restore();
}

function drawSprout(ctx: CanvasRenderingContext2D, facing: number, ry: number, sway: number): void {
  ctx.save();
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(facing * 0.6, -ry + 0.8);
  ctx.quadraticCurveTo(facing * (1 + sway * 2.4), -ry - 4.2, facing * (3.4 + sway * 3), -ry - 6);
  ctx.stroke();
  ctx.restore();
}

/** Tania, kremowa mitenka bez ramienia – unosi się przy broni, jak na makiecie. */
function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = HAND;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Lekkie kształty Canvas, tylko dla części robaków; mieszczą się nad oczami i pod etykietą. */
function drawHat(ctx: CanvasRenderingContext2D, hat: Exclude<WormHat, "none">, o: WormDrawOpts): void {
  ctx.save();
  // Czapki są narysowane w pierwotnych lokalnych współrzędnych: skalowanie
  // trzyma ich rondo tuż nad głową.
  ctx.scale(WORM_RY / 15.9, WORM_RY / 15.9);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  switch (hat) {
    case "cap": {
      ctx.fillStyle = "#4a6aa8";
      ctx.beginPath();
      ctx.moveTo(-10, -15); ctx.quadraticCurveTo(-8, -23, 1, -23);
      ctx.quadraticCurveTo(10, -22, 11, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e8b25a";
      ctx.fillRect(-6, -17, 12, 2);
      ctx.fillStyle = "#34508a";
      ctx.beginPath(); ctx.ellipse(o.facing * 9, -14.5, 7, 1.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case "bucket": {
      ctx.fillStyle = "#b09a6c";
      ctx.beginPath(); ctx.moveTo(-9, -21); ctx.lineTo(9, -21);
      ctx.lineTo(11, -15); ctx.lineTo(-11, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#5f7462";
      ctx.fillRect(-10, -18, 20, 2);
      ctx.fillStyle = "#b09a6c";
      ctx.beginPath(); ctx.ellipse(0, -14, 13, 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case "party": {
      ctx.fillStyle = "#b8689a";
      ctx.beginPath(); ctx.moveTo(-9, -15); ctx.lineTo(1, -26);
      ctx.lineTo(9, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#ffdf9a";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-5, -17); ctx.lineTo(4, -20); ctx.stroke();
      ctx.fillStyle = "#ffdf9a";
      ctx.beginPath(); ctx.arc(1, -26, 2.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "crown": {
      ctx.fillStyle = "#e4ae47";
      ctx.beginPath(); ctx.moveTo(-10, -15); ctx.lineTo(-11, -23);
      ctx.lineTo(-5, -19); ctx.lineTo(0, -26); ctx.lineTo(5, -19);
      ctx.lineTo(11, -23); ctx.lineTo(10, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f8da80"; ctx.fillRect(-10, -17, 20, 2);
      ctx.fillStyle = "#bf5265";
      ctx.beginPath(); ctx.arc(0, -19, 1.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** Dwie krótkie nóżki-guziczki u dołu sylwetki, ciemniejsze od ciała, z konturem. */
function drawFeet(ctx: CanvasRenderingContext2D, p: WormPose, o: WormDrawOpts, rx: number, ry: number): void {
  const squish = 1 - 0.4 * p.squat;
  const airborne = p.state === "jump" || p.state === "fall" || p.state === "jetpack";
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    let fx = s * rx * 0.58 * p.sx;
    let fy = (ry - 0.8) * p.sy;
    if (p.state === "walk") {
      const a = p.step * Math.PI * 2 + (i === 0 ? 0 : Math.PI);
      fx += Math.cos(a) * 2.2 * o.facing;
      fy -= Math.max(0, Math.sin(a)) * 2.6;
    } else if (airborne) {
      fx += s * 0.8;
      fy -= 0.8;
    }
    ctx.fillStyle = o.skin.foot;
    ctx.beginPath();
    ctx.ellipse(fx, fy, 5.4, 3.3 * squish, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = o.skin.ink;
    ctx.lineWidth = 2.1;
    ctx.stroke();
  }
}

/** Twarz: oczy, brwi, usta, policzki. Rysowane w układzie przeskalowanego ciała. */
function drawFace(ctx: CanvasRenderingContext2D, p: WormPose, o: WormDrawOpts, rx: number, ry: number): void {
  const facing = o.facing;
  const eyeY = -ry * 0.33;
  const cx = facing * 2.3;
  const gap = EYE_RX + 0.9;

  drawEye(ctx, cx - gap, eyeY, p.eyeL, p, o);
  drawEye(ctx, cx + gap, eyeY, p.eyeR, p, o);

  if (p.brow !== 0 && p.happyEyes < 0.5 && p.xEyes < 0.5) {
    ctx.strokeStyle = o.skin.ink;
    ctx.lineWidth = 1.9;
    ctx.lineCap = "round";
    const browY = eyeY - EYE_RY - 1.3;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      // brow: -1 groźne (wewnętrzny koniec niżej), +1 zmartwione (wewnętrzny wyżej)
      const inner = s * (gap - 2.6);
      const outer = s * (gap + 2.6);
      const tilt = 1.7 * p.brow;
      ctx.beginPath();
      ctx.moveTo(cx + inner, browY - tilt);
      ctx.lineTo(cx + outer, browY + tilt);
      ctx.stroke();
    }
  }

  if (p.cheeks > 0.05 || p.happyEyes > 0.5) {
    const a = p.happyEyes > 0.5 ? 0.42 : 0.28 + 0.32 * p.cheeks;
    const r = 2 + 1 * p.cheeks;
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ff8a8a";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * (gap + 4.2), eyeY + 5.2, r, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawMouth(ctx, p, o, cx, eyeY + 10);
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  open: number,
  p: WormPose,
  o: WormDrawOpts,
): void {
  const ink = o.skin.ink;
  if (p.xEyes > 0.5) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x, y, EYE_RX, EYE_RY * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.7;
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
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y + 1.6, 2.8, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    return;
  }
  if (open < 0.1) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - EYE_RX * 0.85, y);
    ctx.quadraticCurveTo(x, y + 1.2, x + EYE_RX * 0.85, y);
    ctx.stroke();
    return;
  }

  const ry = EYE_RY * Math.min(open, 1.3);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x, y, EYE_RX, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.clip();
  const px = x + p.pupilX * (EYE_RX - 1.8);
  const py = y + p.pupilY * Math.max(0.2, ry - 2.1);
  ctx.fillStyle = "#1b1216";
  ctx.beginPath();
  ctx.ellipse(px, py, 2.05, 2.45, 0, 0, Math.PI * 2);
  ctx.fill();
  if (p.lid > 0.02) {
    ctx.fillStyle = o.skin.shade;
    ctx.fillRect(x - EYE_RX - 0.5, y - ry - 0.5, EYE_RX * 2 + 1, (ry * 2 + 1) * p.lid * 0.55);
  }
  ctx.restore();

  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(x, y, EYE_RX, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawMouth(ctx: CanvasRenderingContext2D, p: WormPose, o: WormDrawOpts, cx: number, my: number): void {
  const ink = o.skin.ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (p.mouth) {
    case "bigSmile": {
      ctx.fillStyle = "#3a1c22";
      ctx.beginPath();
      ctx.moveTo(cx - 3.6, my - 1);
      ctx.quadraticCurveTo(cx, my + 4.2 + p.mouthOpen * 1.6, cx + 3.6, my - 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f08a94";
      ctx.beginPath();
      ctx.ellipse(cx, my + 2.1 + p.mouthOpen * 0.6, 1.6, 1, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "open": {
      ctx.fillStyle = "#3a1c22";
      ctx.beginPath();
      ctx.ellipse(cx, my + 0.6, 1.7 + p.mouthOpen * 0.7, 1.4 + p.mouthOpen * 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "grit": {
      ctx.fillStyle = "#f4f1ea";
      roundRect(ctx, cx - 3.4, my - 1.3, 6.8, 2.8, 0.9);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 1.1, my - 1.3);
      ctx.lineTo(cx - 1.1, my + 1.5);
      ctx.moveTo(cx + 1.1, my - 1.3);
      ctx.lineTo(cx + 1.1, my + 1.5);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      break;
    }
    case "wave": {
      ctx.beginPath();
      ctx.moveTo(cx - 3.2, my);
      ctx.quadraticCurveTo(cx - 1.6, my - 1.8, cx, my);
      ctx.quadraticCurveTo(cx + 1.6, my + 1.8, cx + 3.2, my);
      ctx.stroke();
      break;
    }
    case "frown": {
      ctx.beginPath();
      ctx.arc(cx, my + 3, 2.6, Math.PI * 1.22, Math.PI * 1.78);
      ctx.stroke();
      break;
    }
    case "flat": {
      ctx.beginPath();
      ctx.moveTo(cx - 2.4, my);
      ctx.lineTo(cx + 2.4, my);
      ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(cx, my - 1, 2.7, 0.3, Math.PI - 0.3);
      ctx.stroke();
    }
  }
}

/** Zarys kształtu, potem wypełnienie – wspólna kreska wszystkich rekwizytów i broni. */
function inked(ctx: CanvasRenderingContext2D, fill: string, lw = 2): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/** Sylwetka broni: lufa wzdłuż +x, chwyt w (0,0). Gruby kontur i płaskie plamy koloru. */
export function drawHeldWeapon(ctx: CanvasRenderingContext2D, weapon: WeaponId): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  switch (weapon) {
    case "drill": {
      roundRect(ctx, -9, -4.4, 20, 8.8, 3);
      inked(ctx, "#3f8aa3");
      ctx.fillStyle = "#9fe0ee";
      ctx.fillRect(-3, -2.6, 10, 1.8);
      ctx.beginPath(); ctx.moveTo(11, -5); ctx.lineTo(22, 0); ctx.lineTo(11, 5); ctx.closePath();
      inked(ctx, "#d7e5ea");
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(13, -3); ctx.lineTo(16, 3); ctx.moveTo(16.5, -1.6); ctx.lineTo(18.5, 1.6); ctx.stroke();
      break;
    }
    case "bazooka":
    case "homing": {
      const homing = weapon === "homing";
      const body = homing ? "#a3402c" : "#7d8b3e";
      const band = homing ? "#7b2e20" : "#5c6a2b";
      const lite = homing ? "#d4694a" : "#a5b559";
      roundRect(ctx, -13, -4.6, 31, 9.2, 3.4);
      inked(ctx, body);
      ctx.fillStyle = lite;
      ctx.fillRect(-9, -3, 21, 1.7);
      // pierścienie na wylocie i z tyłu
      roundRect(ctx, -12.5, -5.6, 4.6, 11.2, 1.6);
      inked(ctx, band, 1.8);
      roundRect(ctx, 11.5, -5.6, 4.6, 11.2, 1.6);
      inked(ctx, band, 1.8);
      // czarny wylot
      ctx.beginPath();
      ctx.ellipse(18, 0, 2.4, 4.6, 0, 0, Math.PI * 2);
      inked(ctx, INK, 1.4);
      // szczerbinka
      roundRect(ctx, -1, -8, 5, 3.6, 1);
      inked(ctx, "#666b76", 1.6);
      if (homing) {
        ctx.beginPath();
        ctx.arc(-1, -8.6, 2.2, 0, Math.PI * 2);
        inked(ctx, "#7cecff", 1.4);
      }
      break;
    }
    case "shotgun": {
      // kolba
      ctx.beginPath();
      ctx.moveTo(1.5, -2.8); ctx.lineTo(-6, -3.8); ctx.lineTo(-15, -1);
      ctx.lineTo(-15, 5.8); ctx.lineTo(-8, 4.8); ctx.lineTo(1.5, 3.2);
      ctx.closePath();
      inked(ctx, "#8b5430");
      ctx.strokeStyle = "#b67c4c";
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(-5, -1.6); ctx.stroke();
      // lufa
      roundRect(ctx, 0, -2.9, 25, 5.8, 2);
      inked(ctx, "#3b3d45");
      ctx.fillStyle = "#6f7480";
      ctx.fillRect(3, -1.8, 19, 1.3);
      // łoże
      roundRect(ctx, 6.5, -3.4, 10, 7.2, 2);
      inked(ctx, "#8b5430", 1.9);
      // kabłąk
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(-2.5, 4.3, 3, 0.1, Math.PI - 0.1); ctx.stroke();
      break;
    }
    case "uzi": {
      roundRect(ctx, -6, -4, 19, 7.6, 2);
      inked(ctx, "#454952");
      ctx.fillStyle = "#7a7f8b";
      ctx.fillRect(-3, -2.6, 13, 1.4);
      roundRect(ctx, 12, -2, 7, 3.6, 1.4);
      inked(ctx, "#2f3239", 1.8);
      roundRect(ctx, 0.5, 3, 4.6, 10, 1.4);
      inked(ctx, "#33363e", 1.8);
      roundRect(ctx, -7, 2.4, 4, 6.5, 1.4);
      inked(ctx, "#33363e", 1.8);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-12, -1); ctx.lineTo(-12, 3); ctx.lineTo(-6, 1); ctx.stroke();
      break;
    }
    case "grenade":
    case "cluster":
    case "holy": {
      const fill = weapon === "grenade" ? "#5e7c34" : weapon === "cluster" ? "#c99a2e" : "#eccb62";
      ctx.beginPath();
      ctx.arc(4, 0.5, 6.4, 0, Math.PI * 2);
      inked(ctx, fill);
      ctx.strokeStyle = "rgba(28,21,25,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-1.6, -1.8); ctx.lineTo(9.6, -1.8);
      ctx.moveTo(-1.6, 3.4); ctx.lineTo(9.6, 3.4);
      ctx.stroke();
      if (weapon === "holy") {
        ctx.fillStyle = INK;
        ctx.fillRect(3.2, -4.6, 1.8, 10);
        ctx.fillRect(0.8, -1.6, 6.6, 1.8);
      }
      roundRect(ctx, 2.2, -9, 4.4, 3.8, 1);
      inked(ctx, "#9aa0a8", 1.6);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(8.6, -7, 2.1, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case "banana": {
      ctx.beginPath();
      ctx.moveTo(-3, 2);
      ctx.quadraticCurveTo(4, 9, 12, -3);
      ctx.quadraticCurveTo(6, 3, -3, -2.4);
      ctx.closePath();
      inked(ctx, "#f0d03c");
      ctx.fillStyle = "#6b4a1a";
      ctx.fillRect(11.2, -4.4, 2.2, 2.4);
      break;
    }
    case "dynamite": {
      for (const dx of [-2.6, 2.6, 0]) {
        roundRect(ctx, 1.6 + dx, dx === 0 ? -6.4 : -5.4, 4.6, 12, 1.6);
        inked(ctx, "#c4382e", 1.8);
      }
      ctx.fillStyle = "#efe2c0";
      ctx.fillRect(1.2, -0.6, 10.6, 2.6);
      ctx.strokeStyle = "#d8b45a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(5.4, -6.4);
      ctx.quadraticCurveTo(8.6, -10, 6.6, -12);
      ctx.stroke();
      ctx.fillStyle = "#ffb12b";
      ctx.beginPath(); ctx.arc(6.6, -12.2, 1.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "mine": {
      ctx.beginPath();
      ctx.moveTo(-2, 4.4);
      ctx.quadraticCurveTo(-2, -3, 5, -3.4);
      ctx.quadraticCurveTo(12, -3, 12, 4.4);
      ctx.closePath();
      inked(ctx, "#7c828e");
      ctx.beginPath(); ctx.arc(5, -3.6, 2.4, 0, Math.PI * 2);
      inked(ctx, "#e5382e", 1.5);
      break;
    }
    case "spring": {
      roundRect(ctx, -1, 0, 14, 4.8, 1.6);
      inked(ctx, "#d9a43e");
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0.5, 0); ctx.lineTo(3, -5); ctx.lineTo(5.6, 0); ctx.lineTo(8.2, -5); ctx.lineTo(10.8, 0);
      ctx.stroke();
      break;
    }
    case "axe": {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4.4;
      ctx.beginPath(); ctx.moveTo(-2, 6); ctx.lineTo(10, -8); ctx.stroke();
      ctx.strokeStyle = "#9a6238";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2, 6); ctx.lineTo(10, -8); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(6.4, -10.4); ctx.lineTo(16, -12.6); ctx.lineTo(15, -3.2); ctx.lineTo(9.6, -5.6);
      ctx.closePath();
      inked(ctx, "#b9c6cf");
      break;
    }
    case "airstrike": {
      roundRect(ctx, -1, -4, 12, 9, 2);
      inked(ctx, "#40454f");
      ctx.fillStyle = "#95e08a";
      ctx.fillRect(1, -2.2, 6, 3);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(8.5, -4); ctx.lineTo(11, -11); ctx.stroke();
      ctx.beginPath(); ctx.arc(11.2, -11.6, 1.9, 0, Math.PI * 2);
      inked(ctx, "#ff5f56", 1.3);
      break;
    }
    case "teleport": {
      ctx.beginPath(); ctx.arc(5, 0, 5.4, 0, Math.PI * 2);
      inked(ctx, "#a58bf0");
      ctx.strokeStyle = "#efe7ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(5, 0, 7.4, 2.6, 0.5, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case "girder": {
      roundRect(ctx, -1, -3.2, 22, 6.4, 1.4);
      inked(ctx, "#c8703a");
      ctx.strokeStyle = "rgba(28,21,25,0.7)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let x = 2; x < 19; x += 4.4) { ctx.moveTo(x, -3); ctx.lineTo(x + 2.2, 3); }
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
  roundRect(ctx, -facing * 15 - 3.5, -7, 7, 14, 2.6);
  inked(ctx, "#5a6270", 2);
  roundRect(ctx, -facing * 15 - 3.5, -1.5, 7, 3.6, 1);
  inked(ctx, "#343a45", 1.6);
}

function drawBat(ctx: CanvasRenderingContext2D, facing: number, time: number): void {
  ctx.save();
  ctx.rotate(facing * (-0.9 + Math.sin(time * 22) * 0.7));
  roundRect(ctx, 0, -2.6, facing * 24, 5.2, 2.6);
  inked(ctx, "#c58a48", 1.9);
  roundRect(ctx, 0, -2.2, facing * 7, 4.4, 2);
  inked(ctx, "#8b5a2b", 1.6);
  ctx.restore();
}

function drawSweat(ctx: CanvasRenderingContext2D, facing: number, rx: number, ry: number, time: number): void {
  const t = (time * 0.9) % 1;
  const x = -facing * (rx * 0.9);
  const y = -ry * 0.35 + t * 8;
  ctx.globalAlpha = 0.85 * (1 - t);
  ctx.fillStyle = "#9fd8ff";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x, y - 2.8);
  ctx.quadraticCurveTo(x + 2, y + 0.7, x, y + 2.2);
  ctx.quadraticCurveTo(x - 2, y + 0.7, x, y - 2.8);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Sylwetka z makiety: kopuła głowy o promieniu połowy szerokości, proste,
 * lekko wypukłe boki, płaski spód z zaokrąglonymi rogami. Bez szyi i wcięć.
 */
export function bodyPath(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
  const top = -ry;
  const bot = ry;
  const cy = top + rx * 1.02;
  const bulge = 0.8;
  const cr = 6.4;
  ctx.beginPath();
  ctx.moveTo(-rx, cy);
  ctx.arc(0, cy, rx, Math.PI, 0, false);
  ctx.bezierCurveTo(rx + bulge, cy + (bot - cy) * 0.35, rx + bulge * 0.7, bot - cr * 1.7, rx - 0.3, bot - cr);
  ctx.quadraticCurveTo(rx - 0.5, bot, rx - cr, bot);
  ctx.lineTo(-rx + cr, bot);
  ctx.quadraticCurveTo(-rx + 0.5, bot, -rx + 0.3, bot - cr);
  ctx.bezierCurveTo(-rx - bulge * 0.7, bot - cr * 1.7, -rx - bulge, cy + (bot - cy) * 0.35, -rx, cy);
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
