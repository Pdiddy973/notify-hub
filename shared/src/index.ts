export type Severity = 'info' | 'success' | 'warning' | 'error' | 'debug';

export interface MessageField {
  name: string;
  value: string;
  inline?: boolean;
}

// The one shape every adapter produces (PLAN.md section 6).
export interface StandardMessage {
  source: string;
  event: string;
  severity: Severity;
  title: string;
  body?: string;
  fields?: MessageField[];
  url?: string;
  imageUrl?: string;
  timestamp: string;
  // Identifies what the message is about, for state tracking.
  key?: string;
}

// The Discord embed the renderer builds from a standard message.
export interface Embed {
  author?: { name: string };
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: MessageField[];
  image?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}
