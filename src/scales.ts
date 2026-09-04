// 格付けスケールの正本。
//
// KanseiLink は同じ「AAA/AA/A/...」という表記を、性質の違う3つの尺度で使っている。
// これまで列名もグレード表記も共通だったため、公開ページで別々の尺度が並び、
// ARI Award で AAA 認定のサービスに、ランタイムの BB が表示されていた
// （2026-09-04 監査 / founder-ops/AUDIT-AwardGrade-ServiceDB-Join_2026-09-04.md）。
//
// 値が違うのは設計どおりで、混ぜてはいけない。すり合わせも禁止。
// 名前で分けるのがこのファイルの目的で、表示・API・公開物はここから引く。

export type ScaleId = "ai_access_level0" | "axr_runtime" | "site_readability";

export interface ScaleDef {
  id: ScaleId;
  /** 表示名（日本語 / 英語） */
  label: { ja: string; en: string };
  /** 何を入力にしているか */
  inputs: string;
  /** 混同を避けるための一行 */
  disambiguation: { ja: string; en: string };
  /** 凍結されているか。凍結スケールは再採点で書き換えない */
  frozen: boolean;
  /** グレード表記を持つか。持たないものは点数のみ */
  graded: boolean;
}

export const SCALES: Record<ScaleId, ScaleDef> = {
  // ARI Award 2026 Summer。入り口側の事実のみで、自社収集データは使わないと公開明記している。
  // Methodology OS v1（2026-08-25）で Level 0 ベースラインとして凍結保存が決定（grandfathering R2-d）。
  ai_access_level0: {
    id: "ai_access_level0",
    label: { ja: "AI Access Level 0", en: "AI Access Level 0" },
    inputs: "一次情報のみ（公式MCPの有無・API認証方式）。KanseiLink が収集した利用実績は不使用",
    disambiguation: {
      ja: "2026-07-16 時点の凍結スナップショット。AXR Runtime とは式が異なり、直接比較できない",
      en: "A frozen snapshot taken 2026-07-16. Computed differently from AXR Runtime and not directly comparable.",
    },
    frozen: true,
    graded: true,
  },

  // 日次クローラが再計算する運用スコア。AAA には実エージェント呼び出し3回以上の実測フロアがある
  // ため、入り口側が整っていても実測が無ければ AAA にならない。これは仕様であって欠陥ではない。
  axr_runtime: {
    id: "axr_runtime",
    label: { ja: "AXR Runtime", en: "AXR Runtime" },
    inputs: "公式MCPの有無・API認証方式・信頼度に加え、実エージェント呼び出しの件数と成功率",
    disambiguation: {
      ja: "日次で動く運用スコア。AAA には実測フロア（実呼び出し3件以上）があるため、AI Access Level 0 より辛くなる",
      en: "Recomputed daily. AAA requires an evidence floor of at least three real agent calls, so it reads stricter than AI Access Level 0.",
    },
    frozen: false,
    graded: true,
  },

  // 無料診断。サイトが機械から読めるかだけを見る軽量チェックで、格付けではない。
  site_readability: {
    id: "site_readability",
    label: { ja: "サイト可読性チェック", en: "Site readability check" },
    inputs: "公開ページ・robots.txt・llms.txt・sitemap.xml の取得結果",
    disambiguation: {
      ja: "サイトが機械から読めるかを見る軽量チェック。企業やサービスの格付けではない",
      en: "A lightweight check of whether a site can be read by machines. It is not a rating of a company or service.",
    },
    frozen: false,
    graded: false,
  },
};

/** API 応答に添える凡例。どの尺度の数字かを受け手が判別できるようにする。 */
export function scaleLegend(ids: ScaleId[]): Record<string, unknown> {
  return Object.fromEntries(ids.map((id) => {
    const s = SCALES[id];
    return [id, { label: s.label.en, inputs: s.inputs, note: s.disambiguation.en, frozen: s.frozen }];
  }));
}
