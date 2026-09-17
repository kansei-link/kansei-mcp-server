// stdio MCP の stdout は JSON-RPC メッセージ専用。ここに人間向けログが 1 行でも混ざると、
// MCP クライアントは JSON として読めずエラーを出す（公式 SDK の Client では onerror が発火する）。
//
// seed / axr 再計算などのログは HTTP サーバーと共有のコードから console.log で出ており、
// HTTP サーバー（Railway）では stdout のままでよい。そこで stdio 起動時だけ、
// console.log / info / debug を stderr へ向け直す。
//
// このモジュールは src/index.ts の「最初の import」でなければならない。ESM の import は宣言順に
// 評価されるため、後続モジュールの読込時（トップレベル）に出るログもここで捕まえられる。
// MCP のメッセージ送信は SDK が process.stdout.write で直接行うので影響しない。
const toStderr = (...args: unknown[]): void => {
  console.error(...args);
};

console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

export {};
