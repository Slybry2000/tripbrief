import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The announcement of an arrival is sent the moment it happens. This is the
// safety net for the case where that send failed — a provider blip, a redeploy —
// so a quote never sits unannounced because one attempt did not land.
crons.interval(
  "announce arrivals",
  { minutes: 15 },
  internal.alerting.sweepAll,
  {},
);

export default crons;
