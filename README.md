# Worms Online

Turowa gra artyleryjska w stylu Worms z multiplayerem przez sieć (2–4 graczy, każdy z własną drużyną robaków).
Całość w TypeScript: autorytatywny serwer Node + klient w przeglądarce (Canvas 2D), bez żadnych plików assetów.

## Szybki start (bez własnego serwera – Vercel/GitHub Pages + Supabase)

Domyślnie gra nie potrzebuje serwera: klient jest statyczną stroną, a gracz tworzący pokój
uruchamia logikę gry u siebie w przeglądarce. Komunikacja idzie przez **Supabase Realtime**
(klucze publiczne w `.env`, projekt `worms-online`). Wystarczy więc hostować `dist/client`:

- **Vercel**: *Add New → Project → Import* `miskibin/projekt`. `vercel.json` ustawia build
  (`npm run build`, katalog `dist/client`). Jeśli nie mergujesz na `main`, w *Settings → Git*
  ustaw *Production Branch* na `claude/worms-multiplayer-game-4rpz13`.
- **GitHub Pages**: workflow `.github/workflows/pages.yml` buduje klienta przy każdym pushu.
  W *Settings → Pages* ustaw *Source: GitHub Actions* (jeśli workflow nie włączył tego sam).

Potem: otwórz stronę, wpisz nick, „Stwórz pokój”, wyślij kolegom link z kodem.

## Demo — jedna osoba, dwie drużyny

W menu wybierz **„Demo — steruj 2 graczami”** albo otwórz stronę z `?demo=1`.
To pełny lokalny mecz: sterujesz na zmianę Graczem 1 i Graczem 2, bez drugiej karty,
połączenia z Supabase ani drugiej osoby. Działają normalne bronie, fizyka, obrażenia i tury.

Sterowanie automatycznie przechodzi na aktywną drużynę. **F1 / „Pomiń turę”** kończy turę,
**„Nowa gra”** resetuje mecz i losuje mapę. Te opcje oraz wyjście są w menu **☰ / Esc**,
które wstrzymuje lokalną symulację. Lobby multiplayer zawiera graczy i ustawienia, bez czatu.

Gra wypełnia okno i dopasowuje kamerę do jego wymiarów. Przycisk **⛶ / F** uruchamia pełny ekran;
wejście do demo z menu również go uruchamia, jeśli przeglądarka obsługuje tę funkcję.
Canvas korzysta z rozdzielczości ekranu (DPR, do 8 megapikseli). Mapa jest dostępna pod **▧ / M**.
Kamera miękko prowadzi aktywnego robaka podczas ruchu, a po strzale przejmuje lecący pocisk.

Na telefonie lewy joystick steruje wyłącznie chodzeniem. Po prawej są osobne przyciski **▲/▼** do
celowania oraz **SKOK** i **◎ STRZAŁ**, więc można iść i skakać dwoma kciukami. Przytrzymaj **◎**, żeby
zwiększać moc, i puść, żeby strzelić. Pełna moc narasta przez 2 sekundy, po czym strzał pada automatycznie.
Pasek przy robaku i pierścień przycisku pokazują moc. Przeciągnięcie przesuwa kamerę,
a gest dwoma palcami zmienia zbliżenie. Przyciski dotykowe można też włączyć w menu.

## Gra z komputerem

W menu wybierz **„Graj z komputerem”** albo otwórz stronę z `?computer=1`. Grasz Czerwonymi,
a komputer prowadzi Niebieskich: sam wybiera najbliższy cel, broń, kierunek i siłę. Korzysta też
z nalotu i rakiety naprowadzanej, gdy zwykły strzał nie ma dobrej drogi. Celowo ma niewielki błąd,
więc może chybić.

Celownik pokazuje kierunek oraz przybliżoną siłę strzału, ale nie rysuje pełnej trajektorii ani
punktu uderzenia. Wpływ wiatru, grawitacji i terenu trzeba ocenić samodzielnie.

## Własny serwer (opcjonalnie)

```bash
npm install
VITE_TRANSPORT=ws npm run build   # klient łączy się WebSocketem z serwerem Node
npm start                          # http://localhost:3000 (PORT=xxxx żeby zmienić)
```

Serwer po starcie wypisze adresy w sieci lokalnej, np. `http://192.168.1.10:3000` – koledzy w tej samej
sieci wchodzą na ten adres. Przez internet: przekieruj port, użyj tunelu (`ngrok http 3000`,
`cloudflared tunnel --url http://localhost:3000`) albo wrzuć na Render/Fly/Railway (jest `Dockerfile`).

## Rozwój

```bash
npm run dev        # serwer (3000, tsx watch) + Vite (5173, proxy /ws)
npm test           # testy silnika i serwera (vitest)
npm run typecheck
```

Otwórz http://localhost:5173 w dwóch kartach, w jednej „Stwórz pokój”, w drugiej dołącz kodem.

## Jak grać

1. Wpisz nick, stwórz pokój i podeślij kolegom kod (lub link z `?room=KOD`).
2. Host ustawia mapę (seed, gęstość, motyw), liczbę robaków i czas tury. Gracze klikają „Gotowy”, host „Start”.
3. Drużyny grają na zmianę. W swojej turze masz ograniczony czas na ruch i jeden strzał (shotgun: dwa).
4. Wygrywa ostatnia drużyna z żywym robakiem. Po kilku rundach zaczyna się **nagła śmierć**: woda rośnie,
   a HP wszystkich spada.

## Sterowanie

| Klawisz | Akcja |
|---|---|
| `A`/`D` lub `←`/`→` | chodzenie |
| `W`/`S`, `↑`/`↓` lub mysz | celowanie |
| `Enter` | skok do przodu |
| `Backspace` | salto w tył |
| `Spacja` (przytrzymaj) | ładowanie mocy, puszczenie = strzał (shotgun, uzi, kij, dynamit, mina, jetpack strzelają od razu) |
| `1`–`5` | zapalnik granatów (sekundy) |
| `Tab` lub prawy przycisk myszy | panel broni |
| Lewy przycisk myszy na mapie | cel dla nalotu, teleportu, belki i rakiety naprowadzanej |
| `R` | obrót belki (girder) |
| `F1` | pomiń turę |
| `F` / `M` | pełny ekran / mapa |
| `Esc` | menu (poddanie, wyjście, głośność, pomoc) |
| Kółko myszy, przeciąganie, `Shift`+strzałki | zoom i kamera |

## Bronie i mechaniki

Bazooka (wiatr), granat i granat kasetowy, banan, shotgun (2 strzały), uzi, Święty Granat Ręczny,
dynamit, miny (także losowe na mapie), nalot, rakieta naprowadzana, kij baseballowy, teleport,
belka (girder), jetpack. Do tego: zniszczalny teren, wiatr zmieniany co turę, obrażenia od upadku,
topienie się w wodzie, skrzynki ze zdrowiem/bronią/narzędziami spadające na spadochronach,
nagła śmierć z rosnącą wodą, 4 motywy map (łąka, pustynia, śnieg, piekło) i losowe mapy z seeda.

## Architektura

Patrz `ARCHITECTURE.md`. Skrót: `shared/engine` – deterministyczna symulacja (teren jako bitmapa, fizyka,
bronie, tury), `server/` – pokoje, lobby, pętla gry 60 Hz, snapshoty 20 Hz, `client/` – render i UI.
