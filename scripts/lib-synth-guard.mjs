/**
 * P0 #39: synthetic データ生成スクリプト共通ガード
 *
 * 方針（恒久・黙って緩めない/緩和はSECレビュー付きコミットのみ）:
 *   1. デフォルト拒否 — `--fixture-out <path>` が無ければ何も書かずに exit 1
 *   2. 出力先制限 — 出力先は repo 内なら `fixtures/` 配下のみ。`src/`・`dist/`・
 *      配布対象（package.json files）への書き込みは即時 FAIL
 *   3. DB 無変更 — フィクスチャ生成モードでは DB を read-only で開くこと（呼び出し側規約）
 */
import { resolve, sep, relative, isAbsolute, dirname, basename, join } from "node:path";
import { readFileSync, existsSync, realpathSync } from "node:fs";

/** argv から --fixture-out を取り出す。無ければ拒否メッセージを出して exit 1。 */
export function requireFixtureOut(argv, scriptName) {
  const i = argv.indexOf("--fixture-out");
  const out = i >= 0 ? argv[i + 1] : null;
  if (!out || out.startsWith("--")) {
    console.error(
      `[BLOCKED] ${scriptName} はデフォルト拒否です (P0 #39 配布物衛生).\n` +
        `  このスクリプトはもう src/data/ や DB へ synthetic データを書きません。\n` +
        `  テスト用フィクスチャが必要な場合のみ、出力先を明示して実行してください:\n` +
        `    node scripts/${scriptName} --fixture-out fixtures/synthetic/<name>.json\n` +
        `  (fixtures/ 外・src/data/・dist/ への出力は assertSafeOutPath が即時 FAIL させます)`
    );
    process.exit(1);
  }
  return out;
}

/**
 * 出力先の安全検証。違反は即時 exit 1。
 * 許可: ROOT/fixtures/ 配下、または repo 外。
 * 禁止: ROOT/src・ROOT/dist・package.json files に列挙された配布対象・repo 直下その他。
 */
export function assertSafeOutPath(outPath, ROOT) {
  // Windows デバイスパス (\\?\, \\.\) は relative() のルート比較を狂わせて
  // 「repo外」判定に化ける迂回経路（Checker監査 P1-4 実証済み）— 無条件拒否
  if (/^\\\\[?.]\\/.test(outPath)) {
    console.error(`[FAIL] デバイスパス表記 (\\\\?\\ / \\\\.\\) は許可されません: ${outPath}`);
    process.exit(1);
  }
  // 相対パスは cwd でなく repo ROOT 基準で解決（cwd依存の挙動差を排除）し、
  // 実在する親ディレクトリを realpath 正規化して symlink/subst 迂回を潰す
  const absRaw = isAbsolute(outPath) ? resolve(outPath) : resolve(ROOT, outPath);
  let abs = absRaw;
  try {
    let parent = dirname(absRaw);
    const tail = [basename(absRaw)];
    while (!existsSync(parent)) {
      tail.unshift(basename(parent));
      const up = dirname(parent);
      if (up === parent) break;
      parent = up;
    }
    abs = join(realpathSync(parent), ...tail);
  } catch {
    /* realpath失敗時は素のresolve結果で判定（fail-closed側: ROOT配下なら拒否される） */
  }
  const rootReal = (() => {
    try {
      return realpathSync(ROOT);
    } catch {
      return resolve(ROOT);
    }
  })();
  const rel = relative(rootReal, abs);
  const inRepo = !rel.startsWith("..") && !isAbsolute(rel);

  if (!inRepo) return abs; // repo 外（scratchpad 等）は許可

  const top = rel.split(sep)[0];
  if (top === "fixtures") {
    // fixtures/ 配下でも念のため src/data 相当の紛れ込みを拒否
    return abs;
  }

  // 配布対象（files allowlist）との一致も明示的に報告
  let files = [];
  try {
    files = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).files ?? [];
  } catch {
    /* package.json 無しでも src/dist 禁止は維持 */
  }
  const relPosix = rel.split(sep).join("/");
  const inDistribution = files.some((f) => relPosix === f || relPosix.startsWith(f.replace(/\/$/, "") + "/"));

  console.error(
    `[FAIL] synthetic データの出力先が許可範囲外です: ${relPosix}\n` +
      `  許可: fixtures/ 配下 または repo 外のみ。\n` +
      (top === "src" || top === "dist" ? `  違反: ${top}/ は正本/配布対象のため恒久禁止 (P0 #39)。\n` : "") +
      (inDistribution ? `  違反: このパスは package.json files（配布対象）に含まれます。\n` : "") +
      `  何も書き込まずに終了します。`
  );
  process.exit(1);
}
