export interface PronounRule {
  id: string;
  speaker: string;
  listener: string;
  selfPronoun: string;
  otherPronoun: string;
}

export interface RuleMapping {
  id: string;
  zh: string; // Chinese term/pronoun
  vi: string; // Vietnamese translation
}

export type Genre = string;
