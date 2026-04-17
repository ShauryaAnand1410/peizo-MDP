/**
 * PiezoLab — Node.js Backend Server
 * -----------------------------------
 * Reads Arduino serial data, streams to browser via WebSocket.
 * Also logs all readings to a CSV file.
 *
 * Setup:
 *   npm install express socket.io serialport @serialport/parser-readline
 *   node server.js
 *
 * Then open: http://localhost:3001
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const path = require('path');
const fs = require('fs');

const PORT = 3001;
const BAUD_RATE = 9600;
const TAP_THRESHOLD = 30; // ADC value above which a "tap" is detected

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ── Serve the dashboard HTML ──────────────────────────────────
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── CSV logging ───────────────────────────────────────────────
const logFileName = `piezo_log_${new Date().toISOString().slice(0, 10)}.csv`;
const logStream = fs.createWriteStream(path.join(__dirname, logFileName), { flags: 'a' });
logStream.write('timestamp,raw_adc,voltage_v,peak_adc,tap_count\n');
console.log(`[LOG] Logging to: ${logFileName}`);

// ── State ─────────────────────────────────────────────────────
let serialPort = null;
let tapCount = 0;
let lastRaw = 0;
let isConnected = false;
let demoInterval = null;

// ── Auto-detect Arduino serial port ──────────────────────────
async function findArduinoPort() {
  try {
    return 'COM13';
    const ports = await SerialPort.list();
    console.log('[SERIAL] Available ports:', ports.map(p => `${p.path} (${p.manufacturer || 'unknown'})`));

    // Try to find Arduino by manufacturer name
    const arduino = ports.find(p => {
      const mfr = (p.manufacturer || '').toLowerCase();
      const pnp = (p.pnpId || '').toLowerCase();
      return (
        mfr.includes('arduino') ||
        mfr.includes('wch') ||       // CH340 chip (common clone)
        mfr.includes('ch340') ||
        mfr.includes('ftdi') ||
        mfr.includes('silicon lab') ||
        pnp.includes('arduino') ||
        pnp.includes('vid_2341')     // Arduino USB VID
      );
    });

    if (arduino) {
      console.log(`[SERIAL] Found Arduino at: ${arduino.path}`);
      return arduino.path;
    }

    // Fallback: first available port
    if (ports.length > 0) {
      console.log(`[SERIAL] No Arduino detected, trying first port: ${ports[0].path}`);
      return ports[0].path;
    }

    return null;
  } catch (err) {
    console.error('[SERIAL] Error listing ports:', err.message);
    return null;
  }
}

// ── Connect to Arduino ─────────────────────────────────────────
async function connectArduino() {
  const portPath = await findArduinoPort();

  if (!portPath) {
    console.log('[SERIAL] No serial port found. Starting demo mode.');
    startDemoMode();
    return;
  }

  console.log(`[SERIAL] Opening ${portPath} at ${BAUD_RATE} baud...`);

  try {
    serialPort = new SerialPort({ path: portPath, baudRate: BAUD_RATE });
    const parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    serialPort.on('open', () => {
      isConnected = true;
      console.log('[SERIAL] Arduino connected!');
      io.emit('status', 'connected');
      io.emit('log', `Arduino connected on ${portPath}`);
      if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
    });

    serialPort.on('error', (err) => {
      console.error('[SERIAL] Error:', err.message);
      io.emit('log', `Serial error: ${err.message}`);
      isConnected = false;
      startDemoMode();
    });

    serialPort.on('close', () => {
      console.log('[SERIAL] Port closed.');
      isConnected = false;
      io.emit('status', 'disconnected');
    });

    parser.on('data', (line) => {
      line = line.trim();

      // Startup message from Arduino
      if (line === 'PIEZOLAB_READY') {
        console.log('[ARDUINO] Ready signal received.');
        io.emit('log', 'Arduino firmware handshake OK');
        return;
      }

      // Parse: RAW:xxx,VOLTS:y.yyy,PEAK:zzz
      if (!line.includes('RAW:')) return;

      const rawMatch = line.match(/RAW:(\d+)/);
      const voltsMatch = line.match(/VOLTS:([\d.]+)/);
      const peakMatch = line.match(/PEAK:(\d+)/);

      if (!rawMatch || !voltsMatch) return;

      const raw = parseInt(rawMatch[1]);
      const volts = parseFloat(voltsMatch[1]);
      const peak = peakMatch ? parseInt(peakMatch[1]) : raw;

      // Tap detection: rising edge above threshold
      if (raw > TAP_THRESHOLD && lastRaw <= TAP_THRESHOLD) {
        tapCount++;
      }
      lastRaw = raw;

      const data = {
        raw,
        volts: parseFloat(volts.toFixed(4)),
        peak,
        taps: tapCount,
        ts: Date.now()
      };

      // Broadcast to all connected browsers
      io.emit('piezo', data);

      // Log to CSV
      logStream.write(`${new Date().toISOString()},${raw},${volts.toFixed(4)},${peak},${tapCount}\n`);
    });

  } catch (err) {
    console.error('[SERIAL] Failed to open port:', err.message);
    startDemoMode();
  }
}

// ── Demo mode (no Arduino connected) ─────────────────────────
function startDemoMode() {
  if (demoInterval) return; // already running
  console.log('[DEMO] Starting demo mode (simulated data).');
  io.emit('status', 'demo');

  demoInterval = setInterval(() => {
    // Occasionally simulate a tap (5% chance per tick)
    const isTap = Math.random() < 0.05;
    const raw = isTap
      ? Math.floor(Math.random() * 900 + 50)
      : Math.floor(Math.random() * 25);

    const volts = parseFloat(((raw / 1023) * 5).toFixed(4));
    const peak = raw;

    if (raw > TAP_THRESHOLD && lastRaw <= TAP_THRESHOLD) tapCount++;
    lastRaw = raw;

    const data = { raw, volts, peak, taps: tapCount, ts: Date.now() };
    io.emit('piezo', data);
    logStream.write(`${new Date().toISOString()},${raw},${volts},${peak},${tapCount}\n`);
  }, 50); // 20 readings/sec
}

// ── WebSocket events ───────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Dashboard connected: ${socket.id}`);
  socket.emit('status', isConnected ? 'connected' : (demoInterval ? 'demo' : 'disconnected'));
  socket.emit('log', `Server running. ${isConnected ? 'Arduino live.' : 'No Arduino — demo mode.'}`);

  socket.on('disconnect', () => {
    console.log(`[WS] Dashboard disconnected: ${socket.id}`);
  });

  // Allow client to request port list
  socket.on('list_ports', async () => {
    const ports = await SerialPort.list();
    socket.emit('ports', ports.map(p => ({ path: p.path, mfr: p.manufacturer || '?' })));
  });
});

// ── Start server ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║        PiezoLab Backend Server       ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Dashboard: http://localhost:${PORT}    ║`);
  console.log(`║  Logging:   ${logFileName.padEnd(24)} ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  connectArduino();
});

// ── Graceful shutdown ─────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  logStream.end();
  if (serialPort && serialPort.isOpen) serialPort.close();
  process.exit(0);
});
