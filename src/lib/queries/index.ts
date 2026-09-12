// 画面から使う取得処理の入口。実体はドメインごとの隣接モジュールにある。
// 追加するときは新しい関数をドメイン別ファイルへ置き、ここに再エクスポートを足す。

export * from "./feed";
export * from "./records";
export * from "./schedules";
export * from "./notices";
export * from "./members";
export * from "./rankings";
export * from "./venues";
export * from "./notes";
export * from "./competitions";
