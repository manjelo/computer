# Computer Engineering booth

Three live demos for BAU Open Doors, shown fullscreen on the TV from one laptop.

## Start it

    ./start.sh

Wait about 15 seconds while the model's training shapes are prepared. It runs without internet. To close it, press `Alt+F4`, then `Ctrl+C` in the terminal.

## Presenter keys

Switch tracks with `1`, `2` and `3`.

| Track | Key | Does |
|---|---|---|
| **AI** | `T` | Start training |
| | `R` | New blank model (do this for every new group) |
| | `C` | Clear the drawing |
| **Development** | `Space` or `→` | Next stop |
| | `←` | Back |
| | `R` | Restart |
| | `F` | Replay at real speed |
| | `I` `Y` `G` | Pick the app: Instagram, YouTube or an online game |
| | `A` | Visit again: the trip skips DNS and the database (caching) |
| | `L` | Logged out: the API gateway refuses the request |
| | `M` | Mystery fault: a random stop breaks |
| | `H` | Rush hour: the server overloads, then engineers add servers |
| | `D` / `B` | Break DNS / the database on purpose (keys only, no button) |
| **How a computer works** | any letter | Set the goal letter, such as the first letter of a student's name |
| | `Space` or `→` | Next step. When adding on paper, one column at a time. In the race, `Space` is the student's key and `→` skips the race |
| | `←` | Back, one column at a time when adding on paper |
| | `R` | Race again, for the next student |
| | `0` | All switches off, including the two numbers being added, and a fresh race |

In Development, each scenario key switches that scenario on, and pressing it again switches it off. Only one scenario runs at a time, and the app you picked stays the same.

## Running each demo

**AI.** Press `R`. A student draws a shape, and the model is only guessing, at about 33% each. Press `T`. Training takes about 20 seconds, and the percentages on their drawing update after each pass. Then ask them to draw a star or a house: the model has only learned three shapes, so it answers wrongly, usually with high confidence.

**Development.** Let a student pick the app with `I`, `Y` or `G`. Press `Space` one stop at a time and explain each one, then press `F` at the end to show the real speed. After the first trip, add one scenario:

- **Find the broken stop:** press `M`, then `Space` through the trip. The packet stops with no answer and the phone keeps loading. Students guess which stop failed, and the next `Space` turns it red. Press `M` twice for a new random fault.
- **Visit again:** press `A`. DNS and the database fade out as the trip skips them, and the trip is visibly shorter.
- **Logged out:** press `L`. The API gateway sends the request back and the phone shows a login screen.
- **Rush hour:** press `H`, then `Space`. Requests pour in until the server is busy and they queue up. Ask how they'd fix it, then press `Space` to add servers.

**How a computer works.** Ask for the first letter of a student's name and press that key. They click the switches until the letter matches. Press `Space` for the gates, where they click the inputs.

Press `Space` for Doing math. Students pick two numbers from 0 to 15 by clicking the switches. Each `Space` adds one column, from right to left, and shows any carry, until the answer appears. The next `Space` shows the same sum in a chain of adders made of gates, with the carry passing from box to box. Students can click the A and B lamps there to change the numbers.

Press `Space` for the race against the laptop. The student presses `Space` as fast as they can. The 5-second clock starts at their first press, and the laptop counts on one part of its chip at the same time. The result stays up, and `Space` does nothing for 2 seconds so a student still pressing can't skip it. Press `R` for another student, or `Space` for the closing line.

## Before the event: improve the model with real drawings

With the app running, open <http://127.0.0.1:8000/collect>. Several team members draw shapes with the mouse, aiming for at least 40 of each. Restart the app so it learns from them, then check the results:

    .venv/bin/python -m ai.evaluate

One drawing in five is kept out of training for this test. Aim for at least 90%. Drawings are saved in `data/team/`. Student drawings at the event are never saved, because the collect page is the only thing that writes to disk.

Commit the drawings so they are kept with the code:

    git add data/team && git commit -m "Add team drawings"

## Setting it up on another laptop

Copy the folder without `.venv` and `.browser-profile`, then, with internet:

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt

It needs Python 3.14 and Google Chrome.

## Tests

    .venv/bin/python -m pytest
    node --test "tests/web/*.test.mjs"

## Poster

`poster/poster.pdf` is A1. To rebuild it after editing `poster/poster.tex`, run `pdflatex poster.tex` twice in that folder, as one run gives a blank page.
