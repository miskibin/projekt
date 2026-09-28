# Worms Online

Turowa gra artyleryjska w stylu Worms z multiplayerem przez sieć (2–4 graczy, każdy z własną drużyną robaków).
Całość w TypeScript: serwer Node lub tryb MQTT z hostem w przeglądarce oraz klient Canvas 2D.

## Android: gra bez internetu przez Bluetooth

Pobierz `app-debug.apk` z artefaktu **wormsy-android-bluetooth** w najnowszym
[udanym przebiegu Android APK](https://github.com/miskibin/projekt/actions/workflows/android.yml)
i zainstaluj ten sam plik na obu telefonach z Androidem 8 lub nowszym. Telefon
może poprosić o zezwolenie na instalację z pobranego pliku. Jest to wersja testowa
podpisywana przez GitHub Actions; podczas kolejnej instalacji może być potrzebne
odinstalowanie poprzedniej testowej wersji aplikacji.

Na pierwszym telefonie wybierz w menu **Bluetooth**, wpisz nick i kliknij
**Stwórz pokój**. Zezwól na Bluetooth i widoczność urządzenia. Na drugim telefonie
wybierz **Bluetooth**, wpisz nick oraz pokazany u gospodarza kod pokoju,
kliknij **Dołącz** i wybierz telefon gospodarza na liście urządzeń. Oba telefony
potwierdzają gotowość; gospodarz uruchamia grę. Telefony nie muszą być w tej samej
sieci Wi-Fi ani mieć internetu. Po krótkim zerwaniu połączenia gość ponawia
łączenie automatycznie. Bluetooth w tym wydaniu obsługuje jedną parę telefonów.

W tej samej aplikacji działają także tryb serwerowy przez internet oraz
**Wyprawa solo** offline. iPhone / Safari mogą grać przez stronę internetową;
przeglądarkowy tryb Bluetooth jest dostępny tylko w aplikacji na Androida.

APK buduje workflow `.github/workflows/android.yml`: klient Vite jest kopiowany
do zasobów Androida, a Gradle kompiluje `assembleDebug`. Kod Bluetooth znajduje się
w `android/app/src/main/java/pl/miskibin/wormsy/MainActivity.kt`.

## Gra na dwóch telefonach

Otwórzcie **https://wormsy-online.onrender.com/** na obu telefonach. Domyślny tryb
„Serwer gry” prowadzi symulację na Render: gra działa także po chwilowej utracie
połączenia telefonu hosta. Host tworzy pokój i kopiuje link zaproszenia; druga osoba
otwiera link lub wpisuje czteroliterowy kod, zaznacza gotowość i host zaczyna mecz.

W menu można wybrać **MQTT**, żeby symulację prowadził telefon hosta przez publiczny
broker. Oba telefony muszą mieć internet; link zaproszenia zapisuje wybrany tryb.
Ten wariant zależy od połączenia i działania telefonu hosta. Przełączenie trybu
po stworzeniu pokoju wymaga założenia nowego pokoju.

Domyślny **Losowany arsenał** daje obu drużynom ten sam zestaw specjalnych broni
na czas jednego meczu; skrzynki pod walką dodają nowe opcje. Niektóre mecze mają
więcej wybuchowych beczek albo zrzutów, bez nowych przycisków i zasad. W lobby możesz wybrać
**Klasyk**, żeby cały arsenał był dostępny od początku. Wyniki i bronie nie przechodzą
między meczami.

## Demo — jedna osoba, dwie drużyny

W menu wybierz **„Demo — steruj 2 graczami”** albo otwórz stronę z `?demo=1`.
To pełny lokalny mecz: sterujesz na zmianę Graczem 1 i Graczem 2, bez drugiej karty,
połączenia z serwerem ani drugiej osoby. Działają normalne bronie, fizyka, obrażenia i tury.

Sterowanie automatycznie przechodzi na aktywną drużynę. **F1 / „Pomiń turę”** kończy turę,
**„Nowa gra”** resetuje mecz i losuje mapę. Te opcje oraz wyjście są w menu **☰ / Esc**,
które wstrzymuje lokalną symulację. Lobby multiplayer zawiera graczy i ustawienia, bez czatu.

Gra wypełnia okno i dopasowuje kamerę do jego wymiarów. Przycisk **⛶ / F** uruchamia pełny ekran;
wejście do demo z menu również go uruchamia, jeśli przeglądarka obsługuje tę funkcję.
Canvas korzysta z rozdzielczości ekranu z limitem dla telefonów, by nie przegrzewać urządzenia. Mapa jest dostępna pod **▧ / M**.
Kamera miękko prowadzi aktywnego robaka podczas ruchu, a po strzale przejmuje lecący pocisk.
Obraz korzysta z lekkiego bloom, korekcji koloru i winiety. Mocne eksplozje uruchamiają błysk,
krótką aberrację barwną i screen shake zależny od promienia oraz siły wybuchu.

Na telefonie duże strzałki **◀/▶** po lewej sterują chodzeniem. Po prawej są osobne przyciski **▲/▼** do
celowania oraz **SKOK** i **◎ STRZAŁ**, więc można iść i skakać dwoma kciukami. Przytrzymaj **◎**, żeby
zwiększać moc, i puść, żeby strzelić. Pełna moc narasta przez 2 sekundy, po czym strzał pada automatycznie.
Pasek przy robaku i pierścień przycisku pokazują moc. Przeciągnięcie przesuwa kamerę,
a gest dwoma palcami zmienia zbliżenie. Przyciski dotykowe można też włączyć w menu.

Gdy gra druga osoba, panel pozwala wskazać własnego robaka. Gdy przeciwnik zacznie
atak, masz **jedną odpowiedź na turę** przy użyciu zwykłych przycisków: lewo/prawo
robią krok w wybraną stronę, a skok wykonuje odskok. Możesz wcześniej wskazać
własnego robaka w panelu. Działa to także przez internet; okno reakcji pojawia się
po strzale przeciwnika. W panelu pozostaje przycisk mapy **▧**.

Na mapie pojawia się kilka drzew. **Siekierą** można uderzyć stojącego blisko
robaka albo ściąć drzewo: pień przewróci się w stronę ciosu, może przygnieść
każdego robaka na drodze i po chwili zniknie. Wybór **Katapulta** pozwala
postawić jedną ukrytą pułapkę na drużynę w meczu. Przeciwnik nie otrzyma jej
pozycji w pakietach sieciowych przed uruchomieniem; gdy na nią wejdzie,
zostanie wyrzucony w górę i na bok. Sama pułapka nie odbiera HP.

## Gra z komputerem

W menu wybierz **„Graj z komputerem”** albo otwórz stronę z `?computer=1`. Grasz Czerwonymi,
a komputer prowadzi Niebieskich: sam wybiera najbliższy cel, broń, kierunek i siłę. Korzysta też
z nalotu i rakiety naprowadzanej, gdy zwykły strzał nie ma dobrej drogi. Celowo ma niewielki błąd,
więc może chybić.

**Wyprawa solo** (`?gauntlet=1`) to seria kolejnych, losowanych pojedynków bez
zapisu postępów między sesjami. Po zwycięstwie wybierz **Dostawy** (więcej skrzynek,
losowy arsenał) albo **Zbrojownię** (pełny arsenał od początku), z tymi samymi
zasadami dla obu drużyn. Kolejne areny zmieniają teren, motyw i przeciwnika;
późniejsze mają więcej robaków i krótsze tury. Komputer ma siedem stylów gry
i reaguje krokiem lub skokiem na atak.
Po porażce **Nowa wyprawa** startuje od początku. Cała symulacja działa offline
na telefonie, więc nie zależy od połączenia z serwerem.

Celownik pokazuje kierunek oraz przybliżoną siłę strzału, ale nie rysuje pełnej trajektorii ani
punktu uderzenia. Wpływ wiatru, grawitacji i terenu trzeba ocenić samodzielnie.

## Stały serwer dla gry na dwóch telefonach

Tryb MQTT używa telefonu tworzącego pokój jako hosta symulacji. Hotspot
nie usuwa tej zależności: pakiety nadal przechodzą przez publiczny broker.
`render.yaml` uruchamia serwer Node w regionie Frankfurt na jednej instancji. Grę otwiera się z adresu usługi Render:
serwer udostępnia stronę i `/ws` z tej samej domeny. Nie trzeba podawać osobnego
adresu API ani udostępniać telefonu jako hosta gry.

[Utwórz własny serwer na Render](https://render.com/deploy?repo=https://github.com/miskibin/projekt)
— przed zatwierdzeniem sprawdź wybrany plan;
po wdrożeniu otwórz adres `https://<nazwa-usługi>.onrender.com/` na obu telefonach.
Blueprint nie wdraża kolejnych commitów automatycznie, żeby aktualizacja kodu
nie przerywała trwającej gry. Nowe wersje trzeba uruchamiać ręcznie w panelu.
Pokój jest trzymany w pamięci jednej instancji, więc restart samej usługi
przerywa trwającą rundę; krótkie zerwanie połączenia telefonu można wznowić.

### Własny serwer w sieci lokalnej

```bash
npm ci
VITE_TRANSPORT=ws npm run build   # klient łączy się WebSocketem z serwerem Node
LAN_MODE=1 npm start               # wypisuje adresy komputera w lokalnej sieci
```

Na obu telefonach otwórz wypisany adres, np. `http://192.168.1.10:3000`, lub
komputer i telefony muszą być w tej samej sieci; hotspot działa, jeżeli komputer
też do niego dołączy. Wariant LAN nie używa serwera Render, lecz wymaga działającego komputera.
Samo połączenie dwóch telefonów hotspotem nie uruchamia serwera gry. W aplikacji
Android tryb Bluetooth uruchamia hosta lokalnie na pierwszym telefonie.

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
Banan rozpada się na wachlarz ośmiu mniejszych bananów, które wybuchają przy kontakcie albo po krótkim
wtórnym zapalniku. Przerwy po uspokojeniu pola walki są skrócone, żeby kolejna tura zaczynała się szybciej.

## Architektura

Patrz `ARCHITECTURE.md`. Skrót: `shared/engine` – deterministyczna symulacja (teren jako bitmapa, fizyka,
bronie, tury), `server/` – pokoje, lobby, pętla gry 60 Hz, snapshoty 20 Hz, `client/` – render i UI.
