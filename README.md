# PiezoLab — Arduino Piezoelectric Dashboard

A full-stack real-time dashboard for your Arduino Uno piezoelectric sensor project.

## What's included

| File | Purpose |
|------|---------|
| `index.html` | Complete frontend dashboard (open in browser) |
| `server.js` | Node.js backend — reads Arduino serial, streams via WebSocket |
| `README.md` | This file |

---

## Setup in 3 steps

### Step 1 — Install dependencies

Make sure Node.js is installed (`node --version` to check). Then:

```bash
npm install express socket.io serialport @serialport/parser-readline
```

### Step 2 — Upload Arduino sketch

Copy the Arduino code from the **Code** tab in the dashboard, or use this:

```cpp
const int PIEZO_PIN = A1;
const float VREF = 5.0;
const int ADC_MAX = 1023;
int ledPins[] = {2, 3, 4, 5, 6};
int peakRaw = 0;
unsigned long peakTimer = 0;

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < 5; i++) pinMode(ledPins[i], OUTPUT);
  Serial.println("PIEZOLAB_READY");
}

void loop() {
  int raw = analogRead(PIEZO_PIN);
  float voltage = (raw / (float)ADC_MAX) * VREF;
  if (raw > peakRaw) { peakRaw = raw; peakTimer = millis(); }
  if (millis() - peakTimer > 1000) peakRaw = 0;

  Serial.print("RAW:"); Serial.print(raw);
  Serial.print(",VOLTS:"); Serial.print(voltage, 3);
  Serial.print(",PEAK:"); Serial.println(peakRaw);

  for (int i = 0; i < 5; i++)
    digitalWrite(ledPins[i], raw > (i + 1) * 20 ? HIGH : LOW);

  delay(50);
}
```

### Step 3 — Run the server

```bash
node server.js
```

Then open your browser to: **http://localhost:3001**

---

## Features

- **Live tab** — real-time voltage waveform, LED bar graph, session stats
- **Simulator tab** — test the signal chain without hardware
- **Research tab** — full piezoelectric theory, your circuit explained, applications
- **Data Log tab** — timestamped readings table, CSV export
- **Connect tab** — step-by-step connection guide
- **Code tab** — copyable Arduino sketch and Node.js server code

---

## Circuit wiring

```
Piezo disc (+) ──── A1 (Arduino)
                     │
                    1MΩ  ← protects ADC from high voltage spikes
                     │
Piezo disc (–) ──── GND

LEDs: pin 2,3,4,5,6 → 220Ω resistor → LED → GND
```

---

## How it works

1. Arduino reads piezo voltage on A1 (analogRead → 0–1023)
2. Prints `RAW:xxx,VOLTS:y.yyy,PEAK:zzz` to serial at 9600 baud
3. Node.js server (`serialport` package) reads the serial stream
4. Server parses values, detects taps, logs to CSV
5. Server broadcasts via `socket.io` WebSocket
6. Browser dashboard receives data in real time, updates charts + LEDs

---

## Troubleshooting

**"No serial port found"** → Server enters demo mode automatically. Check Arduino is plugged in and the correct port is selected in Arduino IDE.

**"Cannot reach backend"** → Make sure `node server.js` is running before opening the browser.

**Windows port** → Usually `COM3`, `COM4`, etc. The server auto-detects.

**Linux/Mac port** → Usually `/dev/ttyUSB0` or `/dev/ttyACM0`. May need: `sudo chmod 666 /dev/ttyUSB0`
