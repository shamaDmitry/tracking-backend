import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { trackerService } from "./services/TrackerService";
import { PointObject } from "./types";

const app = express();

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((o) => o.trim())
  : "*";

app.use(
  cors({
    origin: allowedOrigins,
  }),
);
app.use(express.json());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.status(200).send({
    status: "Tracking app backend is working",
    timestamp: new Date(),
    origin: process.env.FRONTEND_URL,
  });
});

io.on("connection", (socket) => {
  console.log(`Frontend client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`Frontend client disconnected: ${socket.id}`);
  });
});

const TICK_RATE_MS = 100; // 10 updates per second
const LOST_THRESHOLD_MS = 1000; // 1 second
const REMOVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  const batch = trackerService.getAndClearBatch();

  if (batch.length > 0) {
    io.emit("object_update", batch);
  }
}, TICK_RATE_MS);

setInterval(() => {
  const statusUpdates = trackerService.checkStaleObjects(
    LOST_THRESHOLD_MS,
    REMOVE_THRESHOLD_MS,
  );

  console.log("statusUpdates", statusUpdates);

  if (statusUpdates.length > 0) {
    io.emit("status_update", statusUpdates);
  }
}, 2000);

interface SimulatorState extends PointObject {
  speed: number; // units per second
  targetSpeed: number;
  isAlive: boolean;
}

const trackerStates = new Map<string, SimulatorState>();
const NUM_TRACKERS = 150;

for (let i = 1; i <= NUM_TRACKERS; i++) {
  const baseSpeed = 0.0005 + Math.random() * 0.002;

  trackerStates.set(`TRK-${i}`, {
    id: `TRK-${i}`,
    lat: 50.4501 + (Math.random() * 0.06 - 0.03),
    lng: 30.5234 + (Math.random() * 0.06 - 0.03),
    direction: Math.floor(Math.random() * 360),
    speed: baseSpeed,
    targetSpeed: baseSpeed,
    isAlive: true,
    status: "active",
  });
}

let lastSimTime = Date.now();

const simulateTrackers = () => {
  const now = Date.now();
  const dt = (now - lastSimTime) / 1000; // delta time in seconds
  lastSimTime = now;

  const states = Array.from(trackerStates.values());

  // Roughly every 30 seconds, one random tracker goes offline
  if (Math.random() < dt / 30) {
    const aliveOnes = states.filter((s) => s.isAlive);

    if (aliveOnes.length > 0) {
      const target = aliveOnes[Math.floor(Math.random() * aliveOnes.length)];

      target.isAlive = false;

      io.emit("status_update", [{ id: target.id, status: "lost" }]);
      io.emit("status_log", {
        id: target.id,
        status: "lost",
        timestamp: new Date(),
      });

      console.log(`📡 [SIM] Tracker ${target.id} went offline.`);
    }
  }

  // Roughly every 6 minutes, one random offline tracker comes back
  if (Math.random() < dt / 360) {
    const deadOnes = states.filter((s) => !s.isAlive);

    if (deadOnes.length > 0) {
      const target = deadOnes[Math.floor(Math.random() * deadOnes.length)];

      target.isAlive = true;

      io.emit("status_update", [{ id: target.id, status: "active" }]);
      io.emit("status_log", {
        id: target.id,
        status: "active",
        timestamp: new Date(),
      });

      console.log(`📡 [SIM] Tracker ${target.id} is back online.`);
    }
  }

  trackerStates.forEach((state) => {
    if (!state.isAlive) return;

    // Gradual direction change
    let newDirection = state.direction + (Math.random() * 10 - 5) * dt * 5;

    if (newDirection < 0) newDirection += 360;
    if (newDirection > 360) newDirection -= 360;

    state.direction = Math.round(newDirection);

    // Speed variation
    if (Math.random() < 0.1 * dt) {
      state.targetSpeed = 0.0005 + Math.random() * 0.002;
    }

    const acceleration = 0.0005 * dt;
    if (state.speed < state.targetSpeed) {
      state.speed = Math.min(state.targetSpeed, state.speed + acceleration);
    } else if (state.speed > state.targetSpeed) {
      state.speed = Math.max(state.targetSpeed, state.speed - acceleration);
    }

    // Movement using Delta Time
    const rad = (state.direction * Math.PI) / 180;

    state.lat += Math.cos(rad) * state.speed * dt;
    state.lng += Math.sin(rad) * state.speed * dt;

    trackerService.ingestLocation({
      id: state.id,
      lat: state.lat,
      lng: state.lng,
      direction: state.direction,
    });
  });
};

setInterval(simulateTrackers, 50);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`🚀 Tracking server running on http://localhost:${PORT}`);
});
