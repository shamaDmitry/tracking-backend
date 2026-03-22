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
const LOST_THRESHOLD_MS = 30 * 1000; // 30 seconds
const REMOVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  // 1. Broadcast positions
  const batch = trackerService.getAndClearBatch();

  if (batch.length > 0) {
    io.emit("object_update", batch);
  }
}, TICK_RATE_MS);

// 2. Broadcast status updates on a slower loop (every 2 seconds)
setInterval(() => {
  const statusUpdates = trackerService.checkStaleObjects(
    LOST_THRESHOLD_MS,
    REMOVE_THRESHOLD_MS,
  );

  if (statusUpdates.length > 0) {
    io.emit("status_update", statusUpdates);
  }
}, 2000);

interface SimulatorState extends PointObject {
  speed: number;
  targetSpeed: number;
  isAlive: boolean;
}

const trackerStates = new Map<string, SimulatorState>();

for (let i = 1; i <= 150; i++) {
  const baseSpeed = (0.00025 + Math.random() * 0.001) / 4;

  trackerStates.set(`TRK-${i}`, {
    id: `TRK-${i}`,
    lat: 50.4501 + (Math.random() * 0.06 - 0.03),
    lng: 30.5234 + (Math.random() * 0.06 - 0.03),
    direction: Math.floor(Math.random() * 360),
    speed: baseSpeed,
    targetSpeed: baseSpeed,
    isAlive: true,
  });
}

const simulateTrackers = () => {
  trackerStates.forEach((state, id) => {
    if (state.isAlive && Math.random() > 0.9998) {
      console.log(`📡 [SIM] Tracker ${id} went offline.`);

      state.isAlive = false;
    }

    if (!state.isAlive) return;

    let newDirection = state.direction + (Math.random() * 4 - 2);

    if (newDirection < 0) newDirection += 360;
    if (newDirection > 360) newDirection -= 360;

    if (Math.random() > 0.98) {
      state.targetSpeed = (0.00025 + Math.random() * 0.00125) / 4;
    }

    const acceleration = 0.0000125;

    if (state.speed < state.targetSpeed) {
      state.speed = Math.min(state.targetSpeed, state.speed + acceleration);
    } else if (state.speed > state.targetSpeed) {
      state.speed = Math.max(state.targetSpeed, state.speed - acceleration);
    }

    // 3. Movement
    const rad = (newDirection * Math.PI) / 180;
    state.lat += Math.cos(rad) * state.speed;
    state.lng += Math.sin(rad) * state.speed;
    state.direction = Math.round(newDirection);

    trackerService.ingestLocation({
      id: state.id,
      lat: state.lat,
      lng: state.lng,
      direction: state.direction,
    });
  });
};

setInterval(simulateTrackers, 300);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`🚀 Tracking server running on http://localhost:${PORT}`);
});
