export type MessageSource = "user" | "assistant";

export type NotifyConfig = {
  title: string;
  body: string;
  soundCommand?: string;
};

export type TemplateValues = Record<string, string>;
