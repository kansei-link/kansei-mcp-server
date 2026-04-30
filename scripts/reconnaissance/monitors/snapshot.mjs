/**
 * Snapshot monitor — captures UI screenshots and diffs against yesterday's baseline.
 *
 * Returns an array of findings. Each finding:
 *   {
 *     url: string,
 *     screenshot_path: string,        // newly captured (relative to repo root)
 *     baseline_path: string | null,   // previous baseline if it existed
 *     diff_pct: number | null,        // null if no baseline yet
 *     diff_path: string | null,       // PNG visualizing diff if any
 *     ok: boolean,
 *     urgency: "info" | "warning" | "critical",
 *     reason: string,
 *     error?: string,
 *   }
 *
 * Strategy:
 * - Take fresh screenshot of each URL
 * - If yesterday's baseline exists at data/reconnaissance/baselines/{product}/{slug}.png:
 *     - Compute pixel diff using pixelmatch
 *     - Classify based on diff_threshold_pct (default 5)
 * - Replace baseline with fresh screenshot (rolling window of 1)
 * - First-run for any URL: ok=true, urgency=info, reason="baseline established"
 */

import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BASELINES_DIR = path.join(REPO_ROOT, "data", "reconnaissance", "baselines");
const DIFFS_DIR = path.join(REPO_ROOT, "data", "reconnaissance", "diffs");

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_DIFF_THRESHOLD_PCT = 5;
const DEFAULT_TIMEOUT_MS = 30000;

export async function runSnapshotMonitor(config) {
  const monitor = config.monitors?.snapshot;
  if (!monitor || !monitor.enabled) {
    return [];
  }

  const productSlug = slugify(config.product);
  const productBaselineDir = path.join(BASELINES_DIR, productSlug);
  const productDiffDir = path.join(DIFFS_DIR, productSlug);

  await mkdir(productBaselineDir, { recursive: true });
  await mkdir(productDiffDir, { recursive: true });

  const urls = monitor.urls || [];
  const threshold = monitor.diff_threshold_pct ?? DEFAULT_DIFF_THRESHOLD_PCT;
  const viewport = monitor.viewport || DEFAULT_VIEWPORT;
  const timeoutMs = monitor.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const ignoreSelectors = monitor.ignore_selectors || [];

  if (urls.length === 0) return [];

  const findings = [];
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport,
      userAgent:
        "kansei-link-reconnaissance-ant/0.2 (+https://github.com/michielinksee/synapse-arrows-playbook)",
    });

    for (const url of urls) {
      const finding = await captureAndDiff({
        url,
        productSlug,
        productBaselineDir,
        productDiffDir,
        context,
        threshold,
        timeoutMs,
        ignoreSelectors,
      });
      findings.push(finding);
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return findings;
}

async function captureAndDiff({
  url,
  productSlug,
  productBaselineDir,
  productDiffDir,
  context,
  threshold,
  timeoutMs,
  ignoreSelectors,
}) {
  const slug = urlSlug(url);
  const baselinePath = path.join(productBaselineDir, `${slug}.png`);
  const newScreenshotPath = path.join(productBaselineDir, `${slug}.new.png`);
  const diffPath = path.join(productDiffDir, `${slug}.diff.png`);

  const baselineRel = path.relative(REPO_ROOT, baselinePath).replaceAll("\\", "/");
  const diffRel = path.relative(REPO_ROOT, diffPath).replaceAll("\\", "/");

  let page;
  try {
    page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });

    // Hide dynamic regions if requested
    for (const sel of ignoreSelectors) {
      try {
        await page.evaluate((s) => {
          document.querySelectorAll(s).forEach((el) => {
            el.style.visibility = "hidden";
          });
        }, sel);
      } catch {
        // ignore — selector might not exist on every page
      }
    }

    // Disable animations for stable screenshots
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });

    await page.screenshot({
      path: newScreenshotPath,
      fullPage: false, // viewport-only for stable diffs
    });
  } catch (error) {
    if (page) await page.close().catch(() => {});
    return {
      url,
      screenshot_path: null,
      baseline_path: existsSync(baselinePath) ? baselineRel : null,
      diff_pct: null,
      diff_path: null,
      ok: false,
      urgency: "critical",
      reason: `screenshot capture failed: ${error.message}`,
      error: error.message,
    };
  }
  await page.close().catch(() => {});

  const newScreenshotRel = path.relative(REPO_ROOT, newScreenshotPath).replaceAll("\\", "/");

  // First run: no baseline yet
  if (!existsSync(baselinePath)) {
    // Promote new screenshot to baseline
    await copyFile(newScreenshotPath, baselinePath);
    await unlinkQuiet(newScreenshotPath);
    return {
      url,
      screenshot_path: baselineRel,
      baseline_path: null,
      diff_pct: null,
      diff_path: null,
      ok: true,
      urgency: "info",
      reason: "first run — baseline established",
    };
  }

  // Diff against baseline
  let diffResult;
  try {
    diffResult = await diffPngs(baselinePath, newScreenshotPath, diffPath);
  } catch (error) {
    await unlinkQuiet(newScreenshotPath);
    return {
      url,
      screenshot_path: baselineRel,
      baseline_path: baselineRel,
      diff_pct: null,
      diff_path: null,
      ok: false,
      urgency: "warning",
      reason: `diff failed (likely viewport size mismatch): ${error.message}`,
      error: error.message,
    };
  }

  // Promote new screenshot to baseline (rolling)
  await copyFile(newScreenshotPath, baselinePath);
  await unlinkQuiet(newScreenshotPath);

  const diffPct = diffResult.diffPct;
  const ok = diffPct <= threshold;

  let urgency, reason;
  if (ok) {
    urgency = diffPct === 0 ? "info" : "info";
    reason =
      diffPct === 0
        ? "pixel-perfect match with previous baseline"
        : `${diffPct.toFixed(2)}% drift (within ${threshold}% threshold)`;
  } else if (diffPct > threshold * 2) {
    urgency = "critical";
    reason = `${diffPct.toFixed(2)}% drift (>= ${(threshold * 2).toFixed(0)}% — major UI change)`;
  } else {
    urgency = "warning";
    reason = `${diffPct.toFixed(2)}% drift (> ${threshold}% threshold)`;
  }

  return {
    url,
    screenshot_path: baselineRel,
    baseline_path: baselineRel,
    diff_pct: diffPct,
    diff_path: ok ? null : diffRel,
    ok,
    urgency,
    reason,
  };
}

async function diffPngs(pathA, pathB, diffOutPath) {
  const [bufA, bufB] = await Promise.all([readFile(pathA), readFile(pathB)]);
  const imgA = PNG.sync.read(bufA);
  const imgB = PNG.sync.read(bufB);

  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(
      `dimension mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`
    );
  }

  const { width, height } = imgA;
  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(imgA.data, imgB.data, diffPng.data, width, height, {
    threshold: 0.1,
  });

  const totalPixels = width * height;
  const diffPct = (diffPixels / totalPixels) * 100;

  if (diffPixels > 0) {
    await writeFile(diffOutPath, PNG.sync.write(diffPng));
  }

  return { diffPixels, diffPct };
}

async function unlinkQuiet(p) {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(p);
  } catch {
    // ignore
  }
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function urlSlug(url) {
  try {
    const u = new URL(url);
    const pathPart = u.pathname.replace(/^\/+|\/+$/g, "").replaceAll("/", "_") || "root";
    return `${slugify(u.host)}_${slugify(pathPart)}`;
  } catch {
    return slugify(url);
  }
}
