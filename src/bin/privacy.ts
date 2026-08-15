#!/usr/bin/env node
// kansei-link-privacy — installation id controls (Event Contract v1 §1.2).
//
//   --reset-id  generate a new pseudonymous installation id immediately
//               (severs future linkage; previously sent data is not deleted)
//   --status    show id, age, consent mode

import { getInstallation, resetInstallation } from "../usage/installation.js";
import { transmissionAllowed, readConsent } from "../usage/consent.js";

const arg = process.argv[2] ?? "--status";
if (arg === "--reset-id") {
  const fresh = resetInstallation();
  console.log(`installation_id reset → ${fresh.installation_id}`);
  console.log("Note: this severs future linkage. Data already sent under the previous id is not deleted.");
} else {
  const inst = getInstallation();
  const consent = readConsent();
  const decision = transmissionAllowed(process.env.KANSEI_LIVE_UPDATES);
  const ageDays = Math.floor((Date.now() - Date.parse(inst.generated_at)) / 86400000);
  console.log(`installation_id: ${inst.installation_id}`);
  console.log(`generated: ${inst.generated_at} (${ageDays}d ago; auto-rotates at 90d)`);
  console.log(`transmission: ${decision.allowed ? "ENABLED (Live Updates)" : "OFF (Local Mode)"} [${decision.reason}]`);
  console.log(`consent.json: ${consent ? JSON.stringify(consent) : "absent"}`);
}
