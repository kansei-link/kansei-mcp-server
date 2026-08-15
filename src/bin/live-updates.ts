#!/usr/bin/env node
// kansei-link-live-updates — Consent Contract v1 CLI.
//
//   --enable   show the consent text and enable Live Updates (writes consent.json)
//   --disable  disable (Local Mode; zero transmission)
//   --status   show current mode, contract version, installation id summary
//
// Non-interactive installs stay in Local Mode; this command IS the explicit
// opt-in step. Priority chain: DO_NOT_TRACK / explicit OFF > explicit ON >
// consent.json > default OFF.

import { readConsent, writeConsent, transmissionAllowed, CONSENT_CONTRACT_VERSION } from "../usage/consent.js";
import { getInstallation } from "../usage/installation.js";

const CONSENT_TEXT_JA = `Live Updatesを有効にすると、最新の接続・復旧情報を取得できるかわりに、
仮名化された利用結果（サービスID・成否・エラー分類・所要時間など）をKanseiLINKへ共有します。
検索した文章、プロンプト、APIキー、SaaS上のデータ、ファイル内容は送信されません。
識別子はランダムに生成されるインストールIDのみで（個人・端末情報から作られません）、
90日ごとに自動更新され、\`kansei-link-privacy --reset-id\` でいつでもリセットできます
（リセットは以後の連結を断つもので、過去に送信済みのデータは削除されません）。
いつでも \`kansei-link-live-updates --disable\` で無効化できます。`;

const CONSENT_TEXT_EN = `Enabling Live Updates fetches the latest connection & recovery intelligence,
and in return shares pseudonymous usage outcomes (service ID, success/failure,
error class, latency). Your search text, prompts, API keys, SaaS data, and file
contents are never sent. The only identifier is a randomly generated
installation ID (never derived from personal or device data), auto-rotated
every 90 days and resettable anytime via \`kansei-link-privacy --reset-id\`
(reset severs future linkage; previously sent data is not deleted).
Disable anytime with \`kansei-link-live-updates --disable\`.`;

function status(): void {
  const consent = readConsent();
  const decision = transmissionAllowed(process.env.KANSEI_LIVE_UPDATES);
  const inst = getInstallation();
  console.log(`mode: ${decision.allowed ? "Live Updates" : "Local (zero transmission)"} [${decision.reason}]`);
  console.log(`consent.json: ${consent ? `enabled=${consent.enabled} contract=${consent.contract_version} at=${consent.consented_at}` : "absent"}`);
  console.log(`contract version (current): ${CONSENT_CONTRACT_VERSION}`);
  console.log(`installation_id: ${inst.installation_id} (generated ${inst.generated_at}, rotates after 90 days)`);
  console.log(`what is sent when enabled: service ID, success/failure, error class, latency, tool name, recipe id/version — never search text, prompts, keys, or SaaS data.`);
}

const arg = process.argv[2] ?? "--status";
if (arg === "--enable") {
  console.log(CONSENT_TEXT_JA + "\n\n" + CONSENT_TEXT_EN + "\n");
  writeConsent(true);
  console.log("Live Updates: ENABLED (consent recorded in ~/.kansei-link/consent.json)");
} else if (arg === "--disable") {
  writeConsent(false);
  console.log("Live Updates: DISABLED — Local Mode (zero transmission).");
} else {
  status();
}
