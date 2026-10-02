import type { WeaponId } from "@shared/protocol";
import { INK } from "./wormRenderer";

export const WEAPON_ORDER: WeaponId[] = [
  "bazooka", "grenade", "cluster", "banana",
  "shotgun", "uzi", "holy", "dynamite",
  "mine", "spring", "airstrike", "homing", "drill", "sticky", "mortar", "railgun", "repulsor", "bat", "axe",
  "teleport", "girder", "jetpack", "skip",
];

export const WEAPON_NAMES: Record<WeaponId, string> = {
  bazooka: "Bazooka",
  grenade: "Granat",
  cluster: "Odłamkowy",
  shotgun: "Strzelba",
  uzi: "Uzi",
  holy: "Święty granat",
  dynamite: "Dynamit",
  mine: "Mina",
  airstrike: "Nalot",
  homing: "Rakieta nakierowana",
  drill: "Wiertło",
  sticky: "Ładunek przylepny", mortar: "Moździerz", railgun: "Railgun", repulsor: "Impuls",
  banana: "Banan",
  bat: "Kij bejsbolowy",
  axe: "Siekiera",
  spring: "Katapulta",
  teleport: "Teleport",
  girder: "Belka",
  jetpack: "Plecak odrzutowy",
  skip: "Pomiń turę",
};

/** Kolor rozpoznawczy: kafel wyboru, amunicja i aktywna broń w HUD. */
export const WEAPON_COLORS: Record<WeaponId, string> = {
  bazooka: "#ff9961", grenade: "#9de47f", cluster: "#66f2d1", banana: "#ffe467",
  shotgun: "#f6cb96", uzi: "#b9dbff", holy: "#ffecaa", dynamite: "#ff7368",
  mine: "#aab8c7", airstrike: "#ff8c75", homing: "#71e8ff", drill: "#a2eefb", bat: "#d9a274",
  axe: "#d5e5ed", spring: "#ffca64",
  sticky: "#ef9bb4", mortar: "#ffc477", railgun: "#a8e9fa", repulsor: "#bfa9ff",
  teleport: "#c99dff", girder: "#e3a471", jetpack: "#85d9ff", skip: "#bdc4d1",
};

/** Jednozdaniowa podpowiedź w arsenale, szczególnie przydatna na dotyku. */
export const WEAPON_HINTS: Record<WeaponId, string> = {
  bazooka: "Przytrzymaj strzał, by ustawić siłę. Uważaj na wiatr.",
  grenade: "Odbija się od podłoża. Zapalnik ustawiasz cyframi 1–5.",
  cluster: "Dziesięć odłamków leci wachlarzem; wybuchają przy uderzeniu lub po zapalniku.",
  banana: "Osiem mini bananów rozlatuje się wokół, odbija i wybucha po chwili.",
  shotgun: "Dwa szybkie strzały w jednej turze.",
  uzi: "Krótka seria; dobry wybór z bliska.",
  holy: "Ogromny wybuch po odliczaniu. Odejdź jak najdalej.",
  dynamite: "Połóż przy przeciwniku i uciekaj.",
  mine: "Stawiasz ją przed sobą; po uzbrojeniu czeka na zbliżającego się robaka.",
  airstrike: "Wskaż miejsce na mapie; sześć bomb spadnie po kolei przez cały obszar.",
  homing: "Wskaż cel; rakieta skoryguje lot.",
  drill: "Wierci tunel na 145 px i wybucha pod ziemią. Celuj w grunt pod rywalem.",
  sticky: "Przykleja się do gruntu. Ustaw zapalnik 1–5 s i wysadź osłonę.",
  mortar: "W szczycie lotu rozdziela się na pięć bomb. Ostrzelaj rywali za wzgórzem.",
  railgun: "Przebija wszystkich robaków w jednej linii. Ziemia zatrzymuje strzał.",
  repulsor: "Odrzuca robaki szerokim impulsem. Zepchnij ich do wody; nie niszczy gruntu.",
  bat: "Mocny cios z bliska – zepchnij rywala do wody.",
  axe: "Tnie robaka z bliska albo przewraca drzewo w kierunku uderzenia.",
  spring: "Jedna na drużynę w meczu. Ukryta katapulta wyrzuca rywala, gdy na nią wejdzie.",
  teleport: "Wskaż bezpieczne miejsce na mapie.",
  girder: "Postaw belkę jako osłonę lub most.",
  jetpack: "Lataj przyciskami ruchu, pilnując paliwa.",
  skip: "Oddaj turę bez strzału.",
};

/** Bronie strzelające natychmiast (bez ładowania mocy). */
export const NO_CHARGE: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "shotgun", "uzi", "railgun", "bat", "axe", "spring", "dynamite", "mine", "jetpack", "skip",
]);

/** Bronie wymagające wskazania celu na mapie. */
export const TARGETED: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "airstrike", "teleport", "girder", "homing",
]);

/** Bronie, dla których zapalnik (1–5 s) ma znaczenie. */
export const TIMED: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "grenade", "cluster", "banana", "dynamite", "mine", "holy", "sticky",
]);

/** Ikona broni rysowana proceduralnie w kwadracie s×s (kontekst już wyśrodkowany w 0,0). */
export function drawWeaponIcon(ctx: CanvasRenderingContext2D, id: WeaponId, s: number): void {
  const u = s / 32; // jednostka względem projektu 32×32
  outline = Math.max(1, 1.7 * u);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (id) {
    case "sticky": {
      ctx.fillStyle = "#d35b80";
      rrect(ctx, -10*u, -7*u, 20*u, 16*u, 4*u);
      ctx.fillStyle = "#fff0dd";
      rrect(ctx, -5*u, -3*u, 10*u, 6*u, 1*u);
      ctx.strokeStyle = "#f7bc7e";
      ctx.lineWidth = 2*u;
      ctx.beginPath(); ctx.moveTo(0,-7*u); ctx.lineTo(5*u,-13*u); ctx.stroke();
      break;
    }
    case "mortar": {
      ctx.rotate(-0.7);
      ctx.fillStyle = "#65705a";
      rrect(ctx, -11*u,-6*u,24*u,12*u,3*u);
      ctx.fillStyle = "#edb269";
      rrect(ctx, 8*u,-7*u,5*u,14*u,2*u);
      ctx.fillStyle = "#4b5360";
      rrect(ctx, -9*u,7*u,18*u,4*u,1*u);
      break;
    }
    case "railgun": {
      ctx.rotate(-0.3);
      ctx.fillStyle = "#39485c";
      rrect(ctx,-13*u,-5*u,25*u,10*u,2*u);
      ctx.fillStyle = "#90e5ff";
      for (let i=0;i<3;i++) rrect(ctx,(-3+i*5)*u,-7*u,2*u,14*u,1*u);
      break;
    }
    case "repulsor": {
      ctx.strokeStyle = "#b4a2ff"; ctx.lineWidth = 3*u;
      for (const radius of [5,10,15]) { ctx.beginPath(); ctx.arc(0,0,radius*u,-1.2,1.2); ctx.stroke(); }
      ctx.fillStyle = "#424459"; rrect(ctx,-13*u,-5*u,10*u,10*u,3*u);
      break;
    }
    case "bazooka": {
      ctx.rotate(-0.5);
      ctx.fillStyle = "#707c40";
      rrect(ctx, -13 * u, -4.5 * u, 22 * u, 9 * u, 3.5 * u);
      ctx.fillStyle = "#c0532e";
      ctx.beginPath();
      ctx.moveTo(9 * u, -5 * u);
      ctx.lineTo(15 * u, 0);
      ctx.lineTo(9 * u, 5 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.fillStyle = "#4e5a2a";
      rrect(ctx, -13 * u, -7 * u, 6 * u, 14 * u, 2 * u);
      break;
    }
    case "grenade":
    case "cluster": {
      ctx.fillStyle = "#587a38";
      ctx.beginPath();
      ctx.arc(0, 2 * u, 9 * u, 0, Math.PI * 2);
      ctx.fill();
      ink(ctx);
      ctx.strokeStyle = "#2b5528";
      ctx.lineWidth = 1.4 * u;
      ctx.beginPath();
      ctx.moveTo(-7 * u, -1 * u); ctx.lineTo(7 * u, -1 * u);
      ctx.moveTo(-7 * u, 5 * u); ctx.lineTo(7 * u, 5 * u);
      ctx.stroke();
      ctx.fillStyle = "#a4abb4";
      rrect(ctx, -3 * u, -11 * u, 6 * u, 5.5 * u, 1.5 * u);
      if (id === "cluster") {
        ctx.fillStyle = "#ffd24d";
        for (const a of [-1.2, 0, 1.2]) {
          ctx.beginPath();
          ctx.arc(Math.sin(a) * 12 * u, -12 * u + Math.cos(a) * 2 * u, 2 * u, 0, Math.PI * 2);
          ctx.fill();
          ink(ctx);
        }
      }
      break;
    }
    case "banana": {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 9 * u;
      ctx.beginPath();
      ctx.arc(0, -4 * u, 10 * u, 0.5, Math.PI - 0.5);
      ctx.stroke();
      ctx.strokeStyle = "#f2d040";
      ctx.lineWidth = 5.6 * u;
      ctx.beginPath();
      ctx.arc(0, -4 * u, 10 * u, 0.5, Math.PI - 0.5);
      ctx.stroke();
      ctx.strokeStyle = "#7a5c14";
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(0, -4 * u, 10 * u, 0.55, 0.85);
      ctx.stroke();
      break;
    }
    case "shotgun": {
      ctx.rotate(-0.35);
      ctx.fillStyle = "#8a5a32";
      rrect(ctx, -14 * u, -1 * u, 12 * u, 7 * u, 2 * u);
      ctx.fillStyle = "#5a6470";
      rrect(ctx, -4 * u, -3 * u, 18 * u, 4.5 * u, 1.5 * u);
      ctx.fillStyle = "#a4adb8";
      rrect(ctx, 8 * u, -3.5 * u, 6 * u, 5 * u, 1 * u);
      break;
    }
    case "uzi": {
      ctx.fillStyle = "#5a6470";
      rrect(ctx, -10 * u, -6 * u, 18 * u, 7 * u, 2 * u);
      rrect(ctx, -7 * u, 1 * u, 6 * u, 10 * u, 2 * u);
      ctx.fillStyle = "#a4adb8";
      rrect(ctx, 6 * u, -5 * u, 9 * u, 4 * u, 1.5 * u);
      break;
    }
    case "holy": {
      ctx.fillStyle = "#f0cf58";
      ctx.beginPath();
      ctx.arc(0, 2 * u, 9 * u, 0, Math.PI * 2);
      ctx.fill();
      ink(ctx);
      ctx.strokeStyle = "#fff3b0";
      ctx.lineWidth = 1.8 * u;
      ctx.beginPath();
      ctx.ellipse(0, -8 * u, 8 * u, 2.6 * u, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fffbe6";
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(0, -2 * u); ctx.lineTo(0, 7 * u);
      ctx.moveTo(-3.5 * u, 1 * u); ctx.lineTo(3.5 * u, 1 * u);
      ctx.stroke();
      break;
    }
    case "dynamite": {
      ctx.fillStyle = "#c8443a";
      rrect(ctx, -6 * u, -6 * u, 12 * u, 16 * u, 2 * u);
      ctx.fillStyle = "#f2e2c2";
      ctx.fillRect(-6 * u, -1 * u, 12 * u, 3 * u);
      ctx.strokeStyle = "#c9a24a";
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      ctx.moveTo(0, -6 * u);
      ctx.quadraticCurveTo(6 * u, -12 * u, 2 * u, -14 * u);
      ctx.stroke();
      ctx.fillStyle = "#ffd24d";
      ctx.beginPath();
      ctx.arc(2 * u, -14.5 * u, 2 * u, 0, Math.PI * 2);
      ctx.fill();
      ink(ctx);
      break;
    }
    case "mine": {
      ctx.fillStyle = "#8a95a2";
      ctx.beginPath();
      ctx.arc(0, 2 * u, 8 * u, 0, Math.PI * 2);
      ctx.fill();
      ink(ctx);
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = 2 * u;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8 * u, 2 * u + Math.sin(a) * 8 * u);
        ctx.lineTo(Math.cos(a) * 12 * u, 2 * u + Math.sin(a) * 12 * u);
        ctx.stroke();
      }
      ctx.fillStyle = "#d8402f";
      ctx.beginPath();
      ctx.arc(0, 0, 3 * u, 0, Math.PI * 2);
      ctx.fill();
      ink(ctx);
      break;
    }
    case "spring": {
      ctx.fillStyle = "#bb7c3a";
      rrect(ctx, -13 * u, 7 * u, 26 * u, 5 * u, 2 * u);
      ctx.strokeStyle = "#eef8fa";
      ctx.lineWidth = 2.8 * u;
      ctx.beginPath();
      ctx.moveTo(-10 * u, 7 * u);
      ctx.lineTo(-5 * u, -4 * u);
      ctx.lineTo(0, 7 * u);
      ctx.lineTo(5 * u, -4 * u);
      ctx.lineTo(10 * u, 7 * u);
      ctx.stroke();
      ctx.fillStyle = "#ffbe5c";
      rrect(ctx, -12 * u, -8 * u, 24 * u, 4 * u, 2 * u);
      break;
    }
    case "airstrike": {
      ctx.fillStyle = "#8fa0b8";
      ctx.beginPath();
      ctx.moveTo(-14 * u, -6 * u);
      ctx.lineTo(10 * u, -8 * u);
      ctx.lineTo(14 * u, -4 * u);
      ctx.lineTo(-10 * u, -1 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.fillStyle = "#5b6678";
      ctx.beginPath();
      ctx.moveTo(-6 * u, -6 * u);
      ctx.lineTo(-2 * u, -12 * u);
      ctx.lineTo(2 * u, -6 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.fillStyle = "#e05a3a";
      for (const dx of [-6, 0, 6]) {
        ctx.beginPath();
        ctx.ellipse(dx * u, 7 * u, 2 * u, 4 * u, 0, 0, Math.PI * 2);
        ctx.fill();
        ink(ctx);
      }
      break;
    }
    case "drill": {
      ctx.rotate(-0.6);
      ctx.fillStyle = "#4a8fa4";
      rrect(ctx, -14 * u, -5 * u, 19 * u, 10 * u, 3 * u);
      ctx.fillStyle = "#a4e9f4";
      for (const dx of [-10, -4, 2]) ctx.fillRect(dx * u, -3.6 * u, 2 * u, 7.2 * u);
      ctx.fillStyle = "#e6f7ff";
      ctx.beginPath();
      ctx.moveTo(5 * u, -7 * u); ctx.lineTo(15 * u, 0); ctx.lineTo(5 * u, 7 * u);
      ctx.closePath(); ctx.fill();
      ink(ctx);
      break;
    }
    case "homing": {
      ctx.rotate(-0.6);
      ctx.fillStyle = "#d8404c";
      rrect(ctx, -11 * u, -3.5 * u, 18 * u, 7 * u, 3 * u);
      ctx.fillStyle = "#ecf0f1";
      ctx.beginPath();
      ctx.moveTo(7 * u, -4 * u);
      ctx.lineTo(14 * u, 0);
      ctx.lineTo(7 * u, 4 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.fillStyle = "#ff9a3c";
      ctx.beginPath();
      ctx.moveTo(-11 * u, -3 * u);
      ctx.lineTo(-17 * u, 0);
      ctx.lineTo(-11 * u, 3 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      break;
    }
    case "bat": {
      ctx.rotate(-0.7);
      ctx.fillStyle = "#c48a48";
      ctx.beginPath();
      ctx.moveTo(-12 * u, 2 * u);
      ctx.lineTo(-9 * u, -2 * u);
      ctx.lineTo(11 * u, -6 * u);
      ctx.quadraticCurveTo(15 * u, -2 * u, 11 * u, 3 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.fillStyle = "#7a4a1f";
      rrect(ctx, -14 * u, -1 * u, 5 * u, 4 * u, 1.5 * u);
      break;
    }
    case "axe": {
      ctx.rotate(-0.6);
      ctx.fillStyle = "#87572e";
      rrect(ctx, -2 * u, -14 * u, 4 * u, 29 * u, 2 * u);
      ctx.fillStyle = "#b9d4df";
      ctx.beginPath();
      ctx.moveTo(-2 * u, -13 * u);
      ctx.lineTo(-15 * u, -16 * u);
      ctx.lineTo(-15 * u, -5 * u);
      ctx.lineTo(-2 * u, -7 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      break;
    }
    case "teleport": {
      ctx.strokeStyle = "#9b6bff";
      ctx.lineWidth = 2.4 * u;
      ctx.beginPath();
      ctx.arc(0, 0, 10 * u, 0.4, Math.PI * 1.7);
      ctx.stroke();
      ctx.fillStyle = "#c9aaff";
      ctx.beginPath();
      ctx.moveTo(2 * u, -13 * u);
      ctx.lineTo(9 * u, -8 * u);
      ctx.lineTo(1 * u, -4 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.fillStyle = "#e6dcff";
      ctx.beginPath();
      ctx.arc(0, 0, 3.4 * u, 0, Math.PI * 2);
      ctx.fill();
      ink(ctx);
      break;
    }
    case "girder": {
      ctx.save();
      ctx.rotate(-0.3);
      ctx.fillStyle = "#cf7f3e";
      rrect(ctx, -15 * u, -4 * u, 30 * u, 8 * u, 1.5 * u);
      ctx.fillStyle = "#93542a";
      for (let i = -12; i <= 10; i += 6) ctx.fillRect(i * u, -2.6 * u, 2 * u, 5.2 * u);
      ctx.restore();
      break;
    }
    case "jetpack": {
      ctx.fillStyle = "#6a7684";
      rrect(ctx, -8 * u, -10 * u, 6 * u, 14 * u, 2 * u);
      rrect(ctx, 2 * u, -10 * u, 6 * u, 14 * u, 2 * u);
      ctx.fillStyle = "#ff9a3c";
      for (const dx of [-5, 5]) {
        ctx.beginPath();
        ctx.moveTo(dx * u - 3 * u, 4 * u);
        ctx.lineTo(dx * u, 14 * u);
        ctx.lineTo(dx * u + 3 * u, 4 * u);
        ctx.closePath();
        ctx.fill();
        ink(ctx);
      }
      break;
    }
    case "skip": {
      ctx.fillStyle = "#93a0b8";
      ctx.beginPath();
      ctx.moveTo(-11 * u, -8 * u);
      ctx.lineTo(1 * u, 0);
      ctx.lineTo(-11 * u, 8 * u);
      ctx.closePath();
      ctx.fill();
      ink(ctx);
      ctx.fillRect(4 * u, -8 * u, 4 * u, 16 * u);
      break;
    }
  }
  ctx.restore();
}

let outline = 1.6;

function ink(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = outline;
  ctx.stroke();
  ctx.restore();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
  ink(ctx);
}
