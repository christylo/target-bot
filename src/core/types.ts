export type Availability = "in_stock" | "out_of_stock" | "coming_soon" | "unknown";

export type SnapshotSource = "dom-text" | "structured-data" | "mixed" | "local-file" | "browser-session";

export interface StockSnapshot {
  provider: "target";
  productName: string;
  productUrl: string;
  canonicalUrl: string;
  availability: Availability;
  price?: string;
  checkedAt: string;
  source: SnapshotSource;
  signals: string[];
  rawSummary: string;
}

export interface StoredState {
  productName: string;
  productUrl: string;
  availability: Availability;
  price?: string;
  lastCheckedAt: string;
  lastChangedAt: string;
  lastAlertedAt?: string;
}

export interface AlertMessage {
  subject: string;
  body: string;
}

export interface Notifier {
  name: string;
  notify(message: AlertMessage): Promise<void>;
}
