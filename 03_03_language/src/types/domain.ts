export interface ListenIssue {
  trait_id: string;
  evidence: string;
  fix: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ListenSegment {
  start_sec: number;
  end_sec: number;
  text: string;
  confidence: number;
}

export interface ListenResult {
  transcript: string;
  confidence: number;
  strengths: string[];
  issues: ListenIssue[];
  segments: ListenSegment[];
  metadata: {
    word_count: number;
    unique_word_count: number;
    filler_counts: Record<string, number>;
    duration_sec: number;
    estimated_wpm: number | null;
  };
}

export interface LearnerProfile {
  role: string;
  goals: string[];
  weakAreas: string[];
}

export interface SessionRecord {
  session_id: string;
  date: string;
  files: string[];
  phases: number;
  issues: Array<{ trait_id: string; evidence: string; fix: string }>;
  strengths: string[];
  metadata: ListenResult['metadata'] | null;
  feedback_excerpt: string;
}
